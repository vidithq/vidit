import type { Media } from "@/types";

/**
 * Resolve display-derivative URLs from a Media row's original `storage_url`.
 *
 * The backend pipeline (`backend/app/services/storage.py`) writes three
 * sibling objects for a source image:
 *
 *   uploads/<geo>/abc.jpg         ← original (post EXIF-strip)
 *   uploads/<geo>/abc_hero.jpg    ← max-dim 1280 px, JPEG q80
 *   uploads/<geo>/abc_thumb.jpg   ← max-dim 400 px, JPEG q80
 *
 * The naming convention is the single source of truth shared between
 * `derivative_key` (backend) and `mediaUrls` here: rename one, rename both.
 *
 * Which rows carry those siblings is the second half of that contract, and it
 * is the `role`, not the `media_type`, that says so. `storage.upload_file` and
 * the detection path write derivatives for the `source` image they store under
 * `uploads/` and `detected/`. `storage.upload_proof_image` passes
 * `produce_derivatives=False`, so a `proof` image under `proof/` has an
 * original and nothing else: it renders inline in a Tiptap body from the raw
 * `storage_url`, and two unfetched JPEGs per upload would sit under Object Lock
 * retention for a year. A `proof` url rewritten to `_thumb` therefore addresses
 * an object that was never written, which the CDN answers 403 and every card
 * showing that tile paints as a broken picture.
 *
 * Video Media rows have no derivatives either; callers skip this helper for
 * them via `media.media_type` (see `displayUrlsFor`).
 *
 * Deriving in the frontend rather than carrying explicit URLs is a beta-stage
 * shortcut. Once the rule needs more than the role to state it, a follow-up
 * adds `hero_url` / `thumbnail_url` columns and the frontend reads them, with
 * the same helper signature.
 */
export interface MediaUrlBundle {
  original: string;
  hero: string;
  thumbnail: string;
}

function mediaUrls(storage_url: string): MediaUrlBundle {
  // Locate the extension dot in the path component only — a naive
  // `lastIndexOf(".")` over the whole URL picks up the domain dot
  // (`cdn.example.com`) on extensionless paths and breaks the rewrite.
  // Bounding above by `?` / `#` keeps query strings + fragments out of the
  // stem so future signed-URL or cache-buster suffixes aren't clobbered
  // into the derivative name.
  const queryIdx = storage_url.search(/[?#]/);
  const pathEnd = queryIdx === -1 ? storage_url.length : queryIdx;
  const lastSlash = storage_url.lastIndexOf("/", pathEnd - 1);
  const dotIdx = storage_url.lastIndexOf(".", pathEnd - 1);
  const sameAsOriginal: MediaUrlBundle = {
    original: storage_url,
    hero: storage_url,
    thumbnail: storage_url,
  };
  if (dotIdx === -1 || dotIdx <= lastSlash) {
    // No extension on the path — can't construct sibling keys, so every
    // variant falls back to the original. Real backend URLs always carry
    // an extension; this branch matters when only the domain has dots.
    return sameAsOriginal;
  }
  // Bail if the stem is already a derivative — re-applying the suffix
  // would yield `..._hero_hero.jpg`. Defensive: API responses always point
  // at the original, but this keeps the helper idempotent on round-trip.
  const stem = storage_url.slice(0, dotIdx);
  if (stem.endsWith("_hero") || stem.endsWith("_thumb")) {
    return sameAsOriginal;
  }
  const suffix = storage_url.slice(pathEnd); // empty unless ?query or #fragment
  return {
    original: storage_url,
    hero: `${stem}_hero.jpg${suffix}`,
    thumbnail: `${stem}_thumb.jpg${suffix}`,
  };
}

/**
 * The clip URL carrying the media fragment that makes an unplayed video paint
 * its first frame instead of a black rectangle: the browser seeks a tenth of a
 * second in while it loads metadata. Stored clips carry no poster derivative,
 * so this is what stands in for one, and it is the single home of the fragment
 * for every surface that shows a video still (the player, the card thumbnail,
 * the media manager's tiles). Pair it with `preload="metadata"`, which is what
 * makes the browser fetch far enough to decode that frame.
 *
 * A URL that already names a fragment keeps it, so an explicit start time from
 * a caller wins.
 */
export function posterFrameUrl(src: string): string {
  return src.includes("#") ? src : `${src}#t=0.1`;
}

/**
 * Pick the URL for a Media row at the desired render size, accounting for
 * `media_type` and `role`. Videos fall back to the original (no first-frame
 * extraction yet), and so does a `proof` image, which the pipeline stores
 * without derivatives. Use in `<img>` / `<video>` `src` instead of raw
 * `storage_url`.
 */
export function displayUrlsFor(
  media: Pick<Media, "storage_url" | "media_type" | "role">,
): MediaUrlBundle {
  if (media.media_type !== "image" || media.role === "proof") {
    return {
      original: media.storage_url,
      hero: media.storage_url,
      thumbnail: media.storage_url,
    };
  }
  return mediaUrls(media.storage_url);
}
