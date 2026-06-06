/**
 * Resolve display-derivative URLs from a Media row's original
 * `storage_url`.
 *
 * The backend pipeline (`backend/app/services/storage.py`) writes
 * three sibling objects per uploaded image:
 *
 *   uploads/<geo>/abc.jpg         ← original (post EXIF-strip)
 *   uploads/<geo>/abc_hero.jpg    ← max-dim 1280 px, JPEG q80
 *   uploads/<geo>/abc_thumb.jpg   ← max-dim 400 px, JPEG q80
 *
 * The structural naming convention is the single source of truth
 * shared between backend and frontend — `derivative_key` on the
 * backend and `mediaUrls` here. If you rename one, rename the other.
 *
 * Why derive in the frontend instead of carrying explicit URLs on the
 * API response? Closed-beta-specific shortcut: every Media row
 * created post-PR-2 has derivatives by construction (pre-PR-2 demo
 * data is wiped + re-seeded as part of the deploy, and there were no
 * real analyst uploads yet). After analyst #1 lands the assumption
 * is no longer free, but by then a follow-up PR can add explicit
 * `hero_url` / `thumbnail_url` columns and the frontend swaps to
 * reading them — same helper signature.
 *
 * Videos: derivatives don't exist for video Media rows. Callers
 * inspect `media.media_type` and skip this helper for videos
 * (see `displayUrlsFor` which encodes that rule).
 */
export interface MediaUrlBundle {
  original: string;
  hero: string;
  thumbnail: string;
}

function mediaUrls(storage_url: string): MediaUrlBundle {
  // Locate the extension dot in the **path component only** — a naive
  // `lastIndexOf(".")` over the whole URL picks up the dot in the
  // domain (`cdn.example.com`) on extensionless paths and breaks the
  // rewrite. Walking from after the last `/` (or `:`-after-protocol
  // for path-less inputs) and bounded above by `?` / `#` keeps query
  // strings + fragments out of the stem so future signed-URL or
  // cache-buster suffixes don't get clobbered into the derivative
  // name.
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
    // No extension on the path component — can't construct sibling
    // keys, so every variant falls back to the original. Real
    // backend-produced URLs always carry an extension; this branch
    // matters when the protocol/domain contains the only dots.
    return sameAsOriginal;
  }
  // Bail out if the path stem is already a derivative — applying the
  // suffix again would yield `..._hero_hero.jpg`. Defensive: should
  // never happen in API responses (Media.storage_url always points
  // at the original) but keeps the helper idempotent if a caller
  // ever round-trips.
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
 * Pick the right URL for a Media row given the desired render size,
 * accounting for `media_type`. Videos always fall back to the
 * original (no first-frame extraction yet — tracked separately on
 * `next.md`). Use this helper in `<img>` / `<video>` `src` attributes
 * instead of reaching for `storage_url` directly.
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
