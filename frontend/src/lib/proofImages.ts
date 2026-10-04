// Proof-image placeholder plumbing for upload-at-publish. Hand-kept FE↔BE mirrors; change
// each pair together:
//  - `PROOF_PLACEHOLDER_PREFIX` mirrors `sanitize.PROOF_PLACEHOLDER_PREFIX`.
//  - `safeProofFilename` mirrors `storage.safe_original_filename`: intake pairs a
//    `placeholder://<name>` src to a file by `safe_original_filename(file.filename)`, so a
//    different name is a `proof_files_mismatch` 400.

/** Src scheme for a not-yet-uploaded proof image; intake rewrites each to the stored URL,
 *  so a persisted doc never carries one. */
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
