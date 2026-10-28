// Mirrors `ALLOWED_IMAGE_TYPES`, `GIF_CONTENT_TYPE`, `ALLOWED_VIDEO_TYPES` and `MAX_GIF_FRAMES`
// in backend services/storage.py; change both.
export const ACCEPTED_IMAGE_MIME = "image/jpeg,image/png,image/webp";
/** A source file or a proof image may also be a GIF: the server stores each frame as a PNG. */
export const GIF_MIME = "image/gif";
export const ACCEPTED_EVIDENCE_IMAGE_MIME = `${ACCEPTED_IMAGE_MIME},${GIF_MIME}`;
export const ACCEPTED_MEDIA_MIME = `${ACCEPTED_EVIDENCE_IMAGE_MIME},video/mp4,video/webm`;
/** The frames a GIF may hold: the server stores each as a PNG and refuses a GIF past it. */
export const MAX_GIF_FRAMES = 6;
