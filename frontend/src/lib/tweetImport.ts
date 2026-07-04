import { apiFetch } from "./api";
import type { TweetImportMedia, TweetImportResponse } from "@/types";

/**
 * Pure helpers for the submit form's tweet-import pipeline. Stateful
 * choreography (abort tokens, staged form writes) lives in
 * `useTweetImport`. Two rules drive the payload split:
 *
 * - SOURCE URL — the quoted tweet's URL when the OP quote-retweets
 *   (OSINT-correct: the analyst is the messenger, not the source). With no
 *   quote, the backend tries the first non-X URL in ``entities.urls``
 *   (analyst typed ``Source: t.me/<channel>/<id>`` in the body); failing
 *   that, falls back to the OP's own URL so the form is filled — the
 *   analyst should override to the real source.
 * - MEDIA SPLIT — uniform across OP and quoted tweet: videos → primary
 *   (``files[]``), images → proof (``/proof-images``, embedded inline in
 *   the Tiptap doc). No video → no primary media loaded; the analyst
 *   attaches it manually. Intentional: most analyst tweets are image-only
 *   proof, so "first image as primary" would systematically mis-label the
 *   annotation as source footage. The syndication endpoint doesn't expose
 *   reply-chain media, so a video posted in a reply is invisible here.
 *
 * Upstream X CDN URLs are pulled via the backend proxy
 * ``/events/import-from-tweet/media`` because the X CDN omits the
 * CORS headers a browser ``fetch`` needs. The proxy is whitelisted to
 * ``pbs.twimg.com`` / ``video.twimg.com`` so a hostile or schema-drifted
 * ``remote_url`` can't open it to arbitrary outbound fetches.
 */

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "";

export async function fetchProxyBlob(
  remoteUrl: string,
  signal: AbortSignal
): Promise<{ blob: Blob; contentType: string } | null> {
  try {
    const proxyUrl = `/events/import-from-tweet/media?u=${encodeURIComponent(remoteUrl)}`;
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
    // AbortError or network failure — caller treats null as "skip this
    // one" so the import continues for the other media items.
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
 * Upload an X-CDN image into ``/proof-images`` for inline embedding in the
 * Tiptap doc. Returns the public URL, or ``null`` on any failure — a single
 * proof-image upload never blocks the import (the analyst can re-attach).
 *
 * DEFERRED: the backend no longer exposes ``/events/proof-images`` (proof
 * images now upload at publish via ``proof_files[]``, see
 * ``components/editor/ProofEditor.tsx``), so this call always fails and
 * every tweet import lands with zero proof images until the rich-interaction
 * rewrite lands. The existing fail-soft design (catch → null) already
 * degrades correctly: the import still completes, just without inline
 * proof imagery, so this is left as-is rather than special-cased.
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
      "/events/proof-images",
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
  content.push({
    type: "paragraph",
    content: [
      {
        type: "text",
        text: `Geolocation by @${parsed.author_handle} — ${parsed.tweet_text}`.trim(),
      },
    ],
  });
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
  for (const url of proofImageUrls) {
    content.push({ type: "image", attrs: { src: url } });
  }
  return { type: "doc", content };
}

/**
 * Split media by TYPE: videos → primary (``files[]``), images → proof. The
 * ``origin`` field is preserved for proof-body attribution but doesn't
 * change which bucket media lands in. See the file header for the rationale.
 */
export function splitMedia(
  media: TweetImportMedia[]
): { primary: TweetImportMedia[]; proof: TweetImportMedia[] } {
  return {
    primary: media.filter((m) => m.kind === "video"),
    proof: media.filter((m) => m.kind === "image"),
  };
}
