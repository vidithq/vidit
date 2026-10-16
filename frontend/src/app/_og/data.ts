import { lookup as dnsLookup, type LookupAddress } from "node:dns";

import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from "undici";

import { API_URL } from "@/lib/api";
import { isFetchableAvatarUrl, isPrivateAddress } from "@/lib/og";

// Server-side reads behind the share cards and `generateMetadata`. Unlike the browser
// `apiFetch`, they send no session cookie (a card must never show more than a signed-out
// visitor sees) and answer a miss with a fallback image, not an exception.

/** Upstream read budget. A crawler gives the whole card a few seconds. */
const API_TIMEOUT_MS = 4000;

/** Pictures come from the media host, not the API, and several may ride one card. Sized for
 * the slowest avatar host in use: a few megabytes of animated GIF. */
const IMAGE_TIMEOUT_MS = 3000;

/** How long a card's upstream payload stays cached: a quarter hour of staleness for not paying
 * a backend round trip per unfurl. Also rate-limit headroom: card requests egress from the
 * deployment's shared IP against a per-IP limit (see `docs/design.md` → *Share cards*). */
const REVALIDATE_SECONDS = 900;

/** Ceiling on one picture's body, above which the caller's fallback is used. */
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

/** The types the card rasteriser (resvg, behind `next/og`) draws. Satori accepts a GIF or WebP
 * data URI and resvg then draws nothing, a blank where the monogram belongs. */
const DRAWABLE_TYPES = ["image/png", "image/jpeg"];

/** The types `sharp` decodes and re-encodes as PNG: the first frame of a GIF, WebP and AVIF. */
const REENCODED_TYPES = ["image/gif", "image/webp", "image/avif"];

/** A drawable picture larger than this is re-encoded too, to keep the data URI small. */
const INLINE_MAX_BYTES = 2 * 1024 * 1024;

/** Long edge of a re-encoded picture: the card's width, enough for any slot on it. */
const REENCODED_MAX_PX = 1200;

/** Decoded-pixel ceiling for the re-encode, against a small file that inflates to a huge
 * canvas. */
const REENCODED_MAX_INPUT_PIXELS = 50_000_000;

/** One upstream read. `missing` is permanent (the row is not there), `failed` is every
 * transient case (rate limit, upstream error, timeout). Kept apart because a crawler caches
 * what it is served: a busy backend must not freeze "no such analyst" into the unfurl. */
export type OgRead<T> = { status: "ok"; data: T } | { status: "missing" } | { status: "failed" };

/** GET a public API payload as a read result. Never throws. */
export async function ogFetch<T>(path: string): Promise<OgRead<T>> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      next: { revalidate: REVALIDATE_SECONDS },
    });
    // 422 joins 404 as a permanent miss: the API answers a path parameter that cannot name a
    // row (a non-UUID id) that way.
    if (res.status === 404 || res.status === 422) return { status: "missing" };
    if (!res.ok) return { status: "failed" };
    return { status: "ok", data: (await res.json()) as T };
  } catch {
    return { status: "failed" };
  }
}

/**
 * Connection guard for the picture legs: reject a host whose name resolves to an address
 * outside the public unicast space, before the socket opens.
 *
 * `isFetchableAvatarUrl` filters the name only; `169.254.169.254.nip.io` is a public hostname
 * whose A record is the cloud metadata address. Checking in the connector rather than
 * pre-resolving means the address judged is the address the socket uses. URLs reaching this
 * leg are server-minted and name the media host only, so the guard is defense in depth.
 *
 * A mixed answer is rejected whole. The answer is asked for whole (`all: true`) and handed
 * back IPv4 first: a runtime without IPv6 egress can't reach a `2a04:…` address, so leading
 * with one costs the card its picture on a host that also has an A record. A single-address
 * ask gets an IPv4 entry whenever the name has one.
 */
const imageDispatcher = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      dnsLookup(hostname, { ...options, all: true as const }, (err, addresses) => {
        if (err) {
          callback(err, "", 0);
          return;
        }
        const resolved = addresses as LookupAddress[];
        if (resolved.length === 0 || resolved.some((entry) => isPrivateAddress(entry.address))) {
          callback(
            new Error(`image host ${hostname} does not resolve to a public address`),
            "",
            0,
          );
          return;
        }
        const ordered = [
          ...resolved.filter((entry) => entry.family === 4),
          ...resolved.filter((entry) => entry.family !== 4),
        ];
        if (options.all) {
          callback(null, ordered);
          return;
        }
        callback(null, ordered[0].address, ordered[0].family);
      });
    },
  },
});

/** A capped body read's answer; `over` and `empty` are kept apart so the warning names the
 * one that happened. */
type CappedRead = { status: "ok"; body: Buffer } | { status: "over" } | { status: "empty" };

/** Read a response body under a running byte budget, checked per chunk so a host can't spend
 * the renderer's memory on a body the guard would reject. */
async function readCapped(body: UndiciResponse["body"], max: number): Promise<CappedRead> {
  if (!body) return { status: "empty" };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > max) return { status: "over" };
      chunks.push(value);
    }
  } finally {
    // A no-op once the body ended; on the over-budget exit it closes the socket.
    await reader.cancel().catch(() => {});
  }
  return total === 0 ? { status: "empty" } : { status: "ok", body: Buffer.concat(chunks) };
}

/** `host` and path of a picture URL, for a log line: the query can carry a signature or
 * token, so it is dropped. */
function imageTarget(value: string | null | undefined): string {
  if (!value) return "(no url)";
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname}`;
  } catch {
    return "(unparsable url)";
  }
}

/** Record why a card fell back to its own drawing, and answer `null`: one warning per
 * rejection, naming the guard or error that ended the read. */
function skipImage(url: string | null | undefined, reason: string): null {
  console.warn(`og image skipped: ${reason} (${imageTarget(url)})`);
  return null;
}

/** True when `value` is on the API's own origin, which serves the local storage backend's
 * pictures (`http://localhost:8000/local-storage/...` in development). The API is trusted as
 * `ogFetch` trusts it, so this origin skips the public-host guards. */
function isApiOrigin(value: string): boolean {
  try {
    return new URL(value).origin === new URL(API_URL).origin;
  } catch {
    return false;
  }
}

/** Re-encode a picture as a PNG resvg draws, at most card-sized: the first frame of an
 * animation, a WebP or AVIF, or a drawable picture too large to inline. */
async function reencodePng(body: Buffer): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  return sharp(body, { limitInputPixels: REENCODED_MAX_INPUT_PIXELS })
    .resize({
      width: REENCODED_MAX_PX,
      height: REENCODED_MAX_PX,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
}

/**
 * Fetch one picture off the media host and inline it as a data URI, or `null` for the caller's
 * fallback (the profile card's monogram, a mosaic's blank tile). One helper for every card
 * picture, so the guards are stated once: `isFetchableAvatarUrl` on the host and
 * `isPrivateAddress` on what it resolves to (see `lib/og.ts`), no redirects (a public host
 * must not bounce the renderer onto a private one), a timeout, a size ceiling enforced as the
 * body arrives, and a decodable content type. A PNG or JPEG under `INLINE_MAX_BYTES` is inlined
 * as fetched; any other decodable picture is re-encoded as PNG first, since resvg draws nothing
 * for it. A rejection costs the fallback and a warning: a card degrades, it does not fail.
 *
 * Reads through `undici`'s own `fetch`, not the global one: `dispatcher` is honoured only by
 * the undici that owns the guarded `Agent`, and a serverless runtime's global `fetch` is a
 * different undici that throws on it, so every picture would fall back while the guard looked
 * applied. This leg has no data cache; the payload reads in `ogFetch` keep theirs, and they
 * are the rate-limit concern.
 */
export async function ogImageDataUri(url: string | null | undefined): Promise<string | null> {
  const ownOrigin = !!url && isApiOrigin(url);
  if (!ownOrigin && !isFetchableAvatarUrl(url)) return skipImage(url, "rejected by the URL guard");
  try {
    const res = await undiciFetch(url as string, {
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      redirect: "error",
      ...(ownOrigin ? {} : { dispatcher: imageDispatcher }),
    });
    if (!res.ok) return skipImage(url, `status ${res.status}`);
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const drawable = DRAWABLE_TYPES.includes(contentType);
    if (!drawable && !REENCODED_TYPES.includes(contentType)) {
      return skipImage(url, `content type ${contentType || "(none)"} is not decodable`);
    }
    // A declared length over the ceiling is refused before a body byte is read; an absent or
    // lying header falls through to the running budget.
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) {
      return skipImage(url, `declared length ${declared} over the ${IMAGE_MAX_BYTES} byte cap`);
    }
    const read = await readCapped(res.body, IMAGE_MAX_BYTES);
    if (read.status === "over") return skipImage(url, `body over the ${IMAGE_MAX_BYTES} byte cap`);
    if (read.status === "empty") return skipImage(url, "empty body");
    if (drawable && read.body.byteLength <= INLINE_MAX_BYTES) {
      return `data:${contentType};base64,${read.body.toString("base64")}`;
    }
    const png = await reencodePng(read.body);
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch (err) {
    return skipImage(url, err instanceof Error ? err.message : String(err));
  }
}
