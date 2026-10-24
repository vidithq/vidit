import type { Media } from "@/types";

/**
 * Resolve display-derivative URLs from a Media row's original `storage_url`.
 *
 * The backend (`services/storage.py`) writes sibling objects for a source image:
 *   uploads/<geo>/abc.jpg        original (post EXIF-strip)
 *   uploads/<geo>/abc_hero.jpg   max-dim 1280 px, JPEG q80
 *   uploads/<geo>/abc_thumb.jpg  max-dim 400 px, JPEG q80
 * The naming mirrors `storage.derivative_key`; change both.
 *
 * Only a source image carries the siblings: a proof image (`role: "proof"`) has an original only,
 * and rewriting its url to `_thumb` addresses an object never written, so the CDN answers 403.
 * Videos have no derivatives either.
 */
export interface MediaUrlBundle {
  original: string;
  hero: string;
  thumbnail: string;
}

function mediaUrls(storage_url: string): MediaUrlBundle {
  // Find the extension dot in the path only: `lastIndexOf(".")` over the whole URL hits the
  // domain dot on extensionless paths. Bounding at `?` / `#` keeps queries and fragments out
  // of the stem.
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
    // No extension: can't build sibling keys, so every variant is the original.
    return sameAsOriginal;
  }
  // Already a derivative: re-applying the suffix would yield `_hero_hero.jpg`.
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

/** The clip URL with a media fragment (`#t=0.1`) so an unplayed video paints its first frame
 *  instead of black. Stored clips have no poster derivative, so this stands in; the one home
 *  of the fragment for every video still. Pair with `preload="metadata"`. A URL that already
 *  has a fragment keeps it. */
export function posterFrameUrl(src: string): string {
  return src.includes("#") ? src : `${src}#t=0.1`;
}

/** Pick the URL for a Media row at the desired size. Videos and proof images fall back to the
 *  original (no derivatives). Use instead of raw `storage_url`. */
export type DisplayMedia = Pick<Media, "storage_url" | "kind" | "role">;

export function displayUrlsFor(media: DisplayMedia): MediaUrlBundle {
  if (media.kind !== "image" || media.role === "proof") {
    return {
      original: media.storage_url,
      hero: media.storage_url,
      thumbnail: media.storage_url,
    };
  }
  return mediaUrls(media.storage_url);
}
