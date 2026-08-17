/**
 * Read `file` as a `data:` URL.
 *
 * The preview mechanism for a staged file, used instead of
 * `URL.createObjectURL`. A `blob:` URL is an entry in the browser's Blob URL
 * registry and has to be revoked, which puts its lifetime in a React effect's
 * cleanup. Dev-mode Strict Mode mounts, cleans up, and re-mounts every effect
 * once right after the initial commit, so that cleanup revokes a URL the
 * already-painted `<img>` still points at, and anything that recreated it has
 * to run again to repair the reference. A `data:` URL is just a string: it is
 * not tracked in a revocable registry, so nothing about it goes stale or needs
 * disposing, and the standard "ignore a stale async result" guard is all the
 * safety a caller needs.
 *
 * One home for both callers: the proof editor's import hydration and the
 * profile header's staged avatar.
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}
