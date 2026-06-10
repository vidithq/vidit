import { apiFetch } from "./api";
import type { TweetImportMedia, TweetImportResponse } from "@/types";

/**
 * Pure helpers for the submit form's tweet-import pipeline. The
 * stateful choreography (abort tokens, staged form writes) lives in
 * `useTweetImport`; these functions only fetch, build files, and seed
 * the proof doc. Two design rules drive the payload split:
 *
 * - SOURCE URL — set to the quoted tweet's URL when the OP quote-
 *   retweets (the OSINT-correct attribution: the analyst is the
 *   messenger, not the source). When there's no quote, the backend
 *   tries the first non-X URL in ``entities.urls`` (analyst typed
 *   ``Source: t.me/<channel>/<id>`` or similar in the body); if
 *   nothing usable surfaces, it falls back to the OP's own URL so
 *   the form is at least filled — the analyst should normally
 *   override this to the real source.
 * - MEDIA SPLIT — uniform rule across OP and quoted tweet:
 *   videos → primary (lands in ``files[]``), images → proof
 *   (uploaded to ``/proof-images``, embedded inline in the Tiptap
 *   doc). When the import yields no video at all, no primary media
 *   is loaded — the analyst attaches the source media manually.
 *   This is intentional: most analyst tweets are image-only proof,
 *   so guessing "first image as primary" would systematically
 *   mis-label the analyst's annotation as the source footage.
 *   Note: the syndication endpoint doesn't expose reply-chain media,
 *   so a video the analyst posted in a reply is invisible here.
 *
 * All upstream X CDN URLs are pulled via the backend proxy
 * ``/geolocations/import-from-tweet/media`` because the X CDN doesn't
 * set the CORS headers a browser ``fetch`` would need. The proxy is
 * whitelisted to ``pbs.twimg.com`` / ``video.twimg.com`` so a hostile
 * or schema-drifted ``remote_url`` can't open it to arbitrary
 * outbound fetches.
 */

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "";

export async function fetchProxyBlob(
  remoteUrl: string,
  signal: AbortSignal
): Promise<{ blob: Blob; contentType: string } | null> {
  try {
    const proxyUrl = `/geolocations/import-from-tweet/media?u=${encodeURIComponent(remoteUrl)}`;
    const res = await fetch(`${apiBase}${proxyUrl}`, {
      credentials: "include",
      signal,
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    const contentType =
      res.headers.get("content-type") ?? blob.type ?? "application/octet-stream";
    return { blob, contentType };
  } catch {
    // AbortError or network failure — caller treats null as "skip
    // this one" so the import continues for the other media items.
    return null;
  }
}

export function makeFile(
  fetched: { blob: Blob; contentType: string },
  media: TweetImportMedia,
  tweetId: string,
  index: number
): File {
  const guessedExt =
    media.remote_url.match(/\.([a-z0-9]{3,4})(?:$|\?)/i)?.[1] ??
    (media.kind === "video" ? "mp4" : "jpg");
  const filename = `tweet-${tweetId}-${index}.${guessedExt}`;
  return new File([fetched.blob], filename, { type: fetched.contentType });
}

/**
 * Upload an X-CDN image into ``/proof-images`` so it can be embedded
 * inline in the Tiptap doc. Returns the public proof-image URL on
 * success, ``null`` on any failure (we never block the import on a
 * single proof-image upload — the analyst can re-attach manually).
 */
export async function uploadAsProofImage(
  remoteUrl: string,
  signal: AbortSignal
): Promise<string | null> {
  const fetched = await fetchProxyBlob(remoteUrl, signal);
  if (fetched === null) return null;
  const ext =
    remoteUrl.match(/\.([a-z0-9]{3,4})(?:$|\?)/i)?.[1] ?? "jpg";
  const fd = new FormData();
  fd.append(
    "file",
    new File([fetched.blob], `tweet-proof.${ext}`, {
      type: fetched.contentType,
    })
  );
  try {
    const result = await apiFetch<{ url: string }>(
      "/geolocations/proof-images",
      { method: "POST", body: fd, signal }
    );
    return result.url;
  } catch {
    return null;
  }
}

export function buildSeedProof(
  parsed: TweetImportResponse,
  proofImageUrls: string[]
) {
  const content: Record<string, unknown>[] = [];
  // OP author + their commentary
  content.push({
    type: "paragraph",
    content: [
      {
        type: "text",
        text: `Geolocation by @${parsed.author_handle} — ${parsed.tweet_text}`.trim(),
      },
    ],
  });
  // Source attribution (when there's a quoted tweet)
  if (parsed.quoted_tweet !== null) {
    content.push({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: `Source: @${parsed.quoted_tweet.author_handle} — ${parsed.quoted_tweet.tweet_text}`.trim(),
        },
      ],
    });
  }
  // Inline proof images
  for (const url of proofImageUrls) {
    content.push({ type: "image", attrs: { src: url } });
  }
  return { type: "doc", content };
}

/**
 * Split media by TYPE: videos → primary (``files[]``), images →
 * proof (``/proof-images`` + inline embed). Uniform across OP and
 * quoted tweet — the ``origin`` field on the payload is preserved
 * for the proof-body attribution but doesn't change which bucket
 * the media lands in. When there's no video, ``primary`` is empty
 * and the analyst attaches the source media manually.
 */
export function splitMedia(
  media: TweetImportMedia[]
): { primary: TweetImportMedia[]; proof: TweetImportMedia[] } {
  return {
    primary: media.filter((m) => m.kind === "video"),
    proof: media.filter((m) => m.kind === "image"),
  };
}
