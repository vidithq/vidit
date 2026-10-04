// Mirrors `ALLOWED_IMAGE_TYPES` / `ALLOWED_VIDEO_TYPES` in backend services/storage.py; change both.
export const ACCEPTED_IMAGE_MIME = "image/jpeg,image/png,image/webp";
export const ACCEPTED_MEDIA_MIME = `${ACCEPTED_IMAGE_MIME},video/mp4,video/webm`;
