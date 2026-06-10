/**
 * Resolve display-derivative URLs from a Media row's original `storage_url`.
 *
 * The backend pipeline (`backend/app/services/storage.py`) writes three
 * sibling objects per uploaded image:
 *
 *   uploads/<geo>/abc.jpg         ← original (post EXIF-strip)
 *   uploads/<geo>/abc_hero.jpg    ← max-dim 1280 px, JPEG q80
 *   uploads/<geo>/abc_thumb.jpg   ← max-dim 400 px, JPEG q80
 *
 * The naming convention is the single source of truth shared between
 * `derivative_key` (backend) and `mediaUrls` here — rename one, rename both.
 *
 * Deriving in the frontend rather than carrying explicit URLs is a
 * closed-beta shortcut: every Media row has derivatives by construction
 * (demo data is wiped + re-seeded on deploy, no real analyst uploads yet).
 * Once that no longer holds, a follow-up adds `hero_url` / `thumbnail_url`
 * columns and the frontend reads them — same helper signature.
 *
 * Video Media rows have no derivatives; callers skip this helper for them
 * via `media.media_type` (see `displayUrlsFor`).
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
 * Pick the URL for a Media row at the desired render size, accounting for
 * `media_type`. Videos fall back to the original (no first-frame extraction
 * yet). Use in `<img>` / `<video>` `src` instead of raw `storage_url`.
 */
export function displayUrlsFor(media: {
  storage_url: string;
  media_type: "image" | "video";
}): MediaUrlBundle {
  if (media.media_type !== "image") {
    return {
      original: media.storage_url,
      hero: media.storage_url,
      thumbnail: media.storage_url,
    };
  }
  return mediaUrls(media.storage_url);
}
