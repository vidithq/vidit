import {
  ACCEPTED_IMAGE_TYPES,
  ACCEPTED_VIDEO_TYPES,
  GIF_CONTENT_TYPE,
  MAX_GIF_FRAMES,
} from "./api-constants";

export const ACCEPTED_IMAGE_MIME = ACCEPTED_IMAGE_TYPES.join(",");
/** A source file or a proof image may also be a GIF: the server stores each frame as a PNG. */
export const GIF_MIME = GIF_CONTENT_TYPE;
export const ACCEPTED_EVIDENCE_IMAGE_MIME = `${ACCEPTED_IMAGE_MIME},${GIF_MIME}`;
export const ACCEPTED_MEDIA_MIME = `${ACCEPTED_EVIDENCE_IMAGE_MIME},${ACCEPTED_VIDEO_TYPES.join(",")}`;
export { MAX_GIF_FRAMES };
