// Mirrors the backend ALLOWED_IMAGE_TYPES / ALLOWED_VIDEO_TYPES in
// services/storage.py (the canonical source; a hand-mirror until the OpenAPI
// codegen lands). Keep in sync when the backend allowlist changes.
export const ACCEPTED_IMAGE_MIME = "image/jpeg,image/png,image/webp";
export const ACCEPTED_MEDIA_MIME = `${ACCEPTED_IMAGE_MIME},video/mp4,video/webm`;
