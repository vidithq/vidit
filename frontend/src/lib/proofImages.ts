// Proof-image placeholder plumbing for upload-at-publish. Hand-kept FE↔BE mirrors; change
// each pair together:
//  - `PROOF_PLACEHOLDER_PREFIX` mirrors `sanitize.PROOF_PLACEHOLDER_PREFIX`.
//  - `safeProofFilename` mirrors `storage.safe_original_filename`: intake pairs a
//    `placeholder://<name>` src to a file by `safe_original_filename(file.filename)`, so a
//    different name is a `proof_files_mismatch` 400.
//  - `gifFrameFilename` mirrors `storage._gif_frame_filename`.

import { GIF_MIME, MAX_GIF_FRAMES } from "./mediaTypes";

/** Src scheme for a not-yet-uploaded proof image; intake rewrites each to the stored URL,
 *  so a persisted body never carries one. */
export const PROOF_PLACEHOLDER_PREFIX = "placeholder://";

// Backend `storage.ORIGINAL_FILENAME_MAX_LEN`.
const ORIGINAL_FILENAME_MAX_LEN = 255;

/** Strip path components and reject control (Cc) / format (Cf) codepoints, like the backend
 *  before the length cap. `null` for empty or all-stripped (the backend stores NULL; a
 *  nameless file can't match a placeholder). HTML / URL chars pass through like the backend. */
function sanitizeFilename(name: string): string | null {
  // Backslash-aware split covers `..\\..\\foo.jpg` on any platform.
  const base = name.replace(/\\/g, "/").split("/").pop()?.trim() ?? "";
  if (!base) return null;
  for (const ch of base) {
    // \p{Cc} control, \p{Cf} format (RTL-override etc.): the backend's `_BAD_UNICODE_CATEGORIES`.
    if (/\p{Cc}|\p{Cf}/u.test(ch)) return null;
  }
  return base.slice(0, ORIGINAL_FILENAME_MAX_LEN);
}

/**
 * Unique backend-safe name to stage a picked proof image under: sanitised like the backend,
 * then disambiguated against `used` (the server rejects duplicate proof filenames). The
 * caller must upload under this exact name. `null` when unusable.
 */
export function safeProofFilename(
  name: string,
  used: ReadonlySet<string>,
): string | null {
  const safe = sanitizeFilename(name);
  if (safe === null) return null;
  if (!used.has(safe)) return safe;

  // Collision: numeric suffix before the extension (`IMG-2.jpg`), under the length cap.
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : "";
  for (let i = 2; i < 1000; i++) {
    const suffix = `-${i}`;
    const budget = ORIGINAL_FILENAME_MAX_LEN - ext.length - suffix.length;
    const candidate = `${stem.slice(0, Math.max(0, budget))}${suffix}${ext}`;
    if (!used.has(candidate)) return candidate;
  }
  return null;
}

/** The frame count of a GIF, read from its block structure without decoding a pixel, or `null`
 *  when the bytes are not a readable GIF. Counts what the server's decoder counts: each image
 *  descriptor before the trailer. */
export function gifFrameCount(bytes: Uint8Array): number | null {
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  if (signature !== "GIF87a" && signature !== "GIF89a") return null;
  const colorTable = (packed: number) => (packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0);
  let at = 13 + colorTable(bytes[10] ?? 0);
  const skipSubBlocks = () => {
    while (at < bytes.length && bytes[at] !== 0) at += bytes[at] + 1;
    at += 1;
  };
  let frames = 0;
  while (at < bytes.length) {
    const block = bytes[at];
    if (block === 0x3b) break;
    if (block === 0x21) {
      at += 2;
      skipSubBlocks();
    } else if (block === 0x2c) {
      at += 10 + colorTable(bytes[at + 9] ?? 0) + 1;
      skipSubBlocks();
      frames += 1;
    } else {
      break;
    }
  }
  return frames > 0 ? frames : null;
}

/** Why the proof editor refuses a GIF, or `null` when it takes it: an unreadable GIF, or one
 *  past `maxFrames` frames. */
export function gifRefusal(frames: number | null, maxFrames: number): string | null {
  if (frames === null) return "Could not read this GIF. Insert a valid GIF file.";
  if (frames <= maxFrames) return null;
  return `This GIF holds ${frames} frames, and a GIF may hold at most ${maxFrames}. Insert a GIF of ${maxFrames} frames or fewer.`;
}

/** How many frames a picked GIF splits into, when it splits into two or more within
 *  `MAX_GIF_FRAMES`: what its media slot names while the split runs. `null` for any other file. */
export async function gifSplitFrames(file: File): Promise<number | null> {
  if (file.type !== GIF_MIME) return null;
  const frames = gifFrameCount(new Uint8Array(await file.arrayBuffer()));
  return frames !== null && frames > 1 && frames <= MAX_GIF_FRAMES ? frames : null;
}

/** `scan.gif` gives `scan-1.png`, `scan-2.png`, or `scan.png` for a lone frame. */
export function gifFrameFilename(name: string, index: number, count: number): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return count > 1 ? `${stem}-${index + 1}.png` : `${stem}.png`;
}

/**
 * Each frame of a GIF as a PNG file, as the GIF displays it, in frame order, the way the server
 * stores a GIF. `null` where the browser cannot decode a GIF frame by frame (no `ImageDecoder`):
 * the GIF then goes in whole, and the server splits it at publish.
 */
export async function splitGif(file: File, frames: number): Promise<File[] | null> {
  if (typeof ImageDecoder === "undefined") return null;
  const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type });
  try {
    const pngs: File[] = [];
    for (let frameIndex = 0; frameIndex < frames; frameIndex++) {
      const { image } = await decoder.decode({ frameIndex });
      const canvas = document.createElement("canvas");
      canvas.width = image.displayWidth;
      canvas.height = image.displayHeight;
      canvas.getContext("2d")?.drawImage(image, 0, 0);
      image.close();
      const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
      if (blob === null) return null;
      const name = gifFrameFilename(file.name, frameIndex, frames);
      pngs.push(new File([blob], name, { type: "image/png" }));
    }
    return pngs;
  } catch {
    return null;
  } finally {
    decoder.close();
  }
}
