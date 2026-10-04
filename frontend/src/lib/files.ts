/**
 * Read `file` as a `data:` URL, the preview mechanism for a staged file. Not
 * `URL.createObjectURL`: a `blob:` URL must be revoked, which ties its lifetime to an effect
 * cleanup, and Strict Mode's mount/cleanup/remount revokes a URL the painted `<img>` still
 * uses. A `data:` URL is a plain string with nothing to dispose; ignoring stale async
 * results is all a caller needs.
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}
