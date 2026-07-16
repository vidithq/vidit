import { PROOF_PLACEHOLDER_PREFIX, safeProofFilename } from "./proofImages";
import type { TweetImportMedia, TweetImportResponse } from "@/types";

/**
 * Pure helpers for the submit form's tweet-import pipeline. Stateful
 * choreography (abort tokens, staged form writes) lives in
 * `useTweetImport`. Two rules drive the payload split:
 *
 * - SOURCE URL: only set on an explicit signal, either the quoted tweet's URL
 *   when the OP quote-retweets (OSINT-correct: the analyst is the messenger,
 *   not the source), or the first footage link the backend recognises in the
 *   OP's own text (X / Telegram / YouTube). With neither signal the field is
 *   left empty; the OP's own URL is never used as a fallback, since that
 *   would credit the analyst as the source.
 * - MEDIA SPLIT: uniform across OP and quoted tweet, videos go to primary
 *   (``files[]``), images go to proof, staged the same way the editor's
 *   "+ Image" control stages a manually picked file (see
 *   `components/editor/ProofEditor.tsx`): downloaded into a `File`, seeded
 *   into the doc as a ``placeholder://<filename>`` image node, and uploaded
 *   as `proof_files[]` only at publish. No video means no primary media
 *   loaded; the analyst attaches it manually. Intentional: most analyst
 *   tweets are image-only proof, so "first image as primary" would
 *   systematically mis-label the annotation as source footage. The
 *   syndication endpoint doesn't expose reply-chain media, so a video
 *   posted in a reply is invisible here.
 *
 * Upstream media URLs are pulled via the backend proxy
 * ``/events/import-from-tweet/media`` because the source CDNs omit the
 * CORS headers a browser ``fetch`` needs. The proxy is whitelisted to the
 * X CDN hosts and the Telegram CDN hosts (see ``is_trusted_media_url`` in
 * ``tweet_ingest``) so a hostile or schema-drifted ``remote_url`` can't
 * open it to arbitrary outbound fetches.
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
 * Download each proof-image media item into a `File`, named exactly the way
 * `ProofEditor`'s "+ Image" control names a manually picked file: through
 * `safeProofFilename`, so the backend's `safe_original_filename` reproduces
 * the same name and the publish-time `placeholder://<filename>` match holds.
 * `used` disambiguates names within one import batch (two same-named media
 * items can't both claim one placeholder). A failed download or an
 * unusable filename drops that one item rather than blocking the import;
 * the caller seeds the doc only with the files that made it through.
 */
export async function fetchProofFiles(
  media: TweetImportMedia[],
  tweetId: string,
  signal: AbortSignal
): Promise<File[]> {
  const files: File[] = [];
  const used = new Set<string>();
  for (let i = 0; i < media.length; i++) {
    const fetched = await fetchProxyBlob(media[i].remote_url, signal);
    if (fetched === null) continue;
    const raw = makeFile(fetched, media[i], tweetId, i);
    const safeName = safeProofFilename(raw.name, used);
    if (safeName === null) continue;
    used.add(safeName);
    files.push(
      safeName === raw.name ? raw : new File([raw], safeName, { type: raw.type })
    );
  }
  return files;
}

export function buildSeedProof(
  parsed: TweetImportResponse,
  proofFiles: File[]
) {
  const content: Record<string, unknown>[] = [];
  content.push({
    type: "paragraph",
    content: [
      {
        type: "text",
        text: `Geolocation by @${parsed.author_handle}: ${parsed.tweet_text}`.trim(),
      },
    ],
  });
  if (parsed.quoted_tweet !== null) {
    content.push({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: `Source: @${parsed.quoted_tweet.author_handle}: ${parsed.quoted_tweet.tweet_text}`.trim(),
        },
      ],
    });
  }
  for (const file of proofFiles) {
    content.push({
      type: "image",
      attrs: { src: `${PROOF_PLACEHOLDER_PREFIX}${file.name}` },
    });
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
