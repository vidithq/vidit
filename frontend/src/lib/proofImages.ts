// Proof-image placeholder plumbing for upload-at-publish.
//
// FE↔BE mirror (hand-kept, change the pair together — see AGENTS.md → "Single
// source of truth"):
//  - `PROOF_PLACEHOLDER_PREFIX` mirrors `sanitize.PROOF_PLACEHOLDER_PREFIX`.
//  - `safeProofFilename` mirrors `storage.safe_original_filename`: the editor
//    must derive the SAME name the backend will compute from the uploaded
//    file's `filename`, because intake pairs a `placeholder://<name>` src to a
//    file by `safe_original_filename(file.filename)`. If the two disagree the
//    upload is a `proof_files_mismatch` 400.

/** Image src scheme the editor uses for a not-yet-uploaded proof image. The
 *  node references the file riding in the same multipart request; evidence
 *  intake rewrites each to the stored URL, so a persisted doc never carries
 *  one. Mirrors the backend constant of the same name. */
export const PROOF_PLACEHOLDER_PREFIX = "placeholder://";

// Backend `storage.ORIGINAL_FILENAME_MAX_LEN`.
const ORIGINAL_FILENAME_MAX_LEN = 255;

/** Strip path components and reject control (Cc) / format (Cf) codepoints,
 *  mirroring the backend `safe_original_filename` before the length cap. Returns
 *  `null` for the empty / all-stripped case (the backend stores NULL there, and
 *  a nameless proof file can't be matched to a placeholder). HTML / URL chars
 *  pass through, exactly like the backend (output-escaping is their defence). */
function sanitizeFilename(name: string): string | null {
  // Backslash-aware split covers `..\\..\\foo.jpg` on any platform.
  const base = name.replace(/\\/g, "/").split("/").pop()?.trim() ?? "";
  if (!base) return null;
  for (const ch of base) {
    // \p{Cc} = control, \p{Cf} = format (RTL-override etc.) — the backend's
    // `_BAD_UNICODE_CATEGORIES`.
    if (/\p{Cc}|\p{Cf}/u.test(ch)) return null;
  }
  return base.slice(0, ORIGINAL_FILENAME_MAX_LEN);
}

/**
 * The unique, backend-safe filename to stage a picked proof image under.
 * Sanitises like the backend, then disambiguates against `used` (names already
 * claimed this session) so two picks of `IMG.jpg` don't collide on one
 * placeholder — the server rejects a duplicate proof filename. The caller must
 * upload the file under this exact name (rebuilding the `File` when it differs)
 * so `safe_original_filename(uploaded.name)` reproduces it. Returns `null` when
 * the name is unusable even after sanitising.
 */
export function safeProofFilename(
  name: string,
  used: ReadonlySet<string>,
): string | null {
  const safe = sanitizeFilename(name);
  if (safe === null) return null;
  if (!used.has(safe)) return safe;

  // Collision: insert a numeric suffix before the extension (`IMG.jpg` →
  // `IMG-2.jpg`), keeping the whole thing under the length cap.
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
