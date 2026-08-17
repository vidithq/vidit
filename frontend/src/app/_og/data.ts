import { lookup as dnsLookup, type LookupAddress } from "node:dns";

import { Agent } from "undici";

import { API_URL } from "@/lib/api";
import { isFetchableAvatarUrl, isPrivateAddress } from "@/lib/og";

// Server-side reads behind the generated share cards and their
// `generateMetadata`. Separate from `lib/api.ts`'s `apiFetch`, which is the
// browser client: it sends the session cookie and the CSRF header, and it
// throws on a non-2xx. A card reads anonymously (the two pages it covers are
// public, so a card must never show more than a signed-out visitor sees) and
// answers a miss with a fallback image rather than an exception.

/** Upstream read budget. A crawler gives the whole card a few seconds. */
const API_TIMEOUT_MS = 4000;

/** Avatars come from third-party hosts, so they get a tighter budget. */
const AVATAR_TIMEOUT_MS = 2000;

/**
 * How long a card's upstream payload stays cached. Counts and titles move
 * slowly and a card is re-fetched by every crawler that sees the link, so the
 * window trades a quarter hour of staleness for not paying a backend round trip
 * per unfurl. It is also the rate-limit headroom: every card request egresses
 * from the deployment's shared IP against a per-IP limit, so the window is what
 * keeps a link going wide from spending that budget (see
 * `docs/design.md` → *Share cards*).
 */
const REVALIDATE_SECONDS = 900;

/** Ceiling on an avatar body, above which the monogram is used instead. */
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Satori decodes these; a `image/webp` or `image/avif` avatar renders as the
 * monogram rather than risking a decode failure that would fail the whole card.
 */
const AVATAR_TYPES = ["image/png", "image/jpeg", "image/gif"];

/**
 * One upstream read. `missing` is the permanent answer (the row is not there),
 * `failed` is every transient one (rate limit, upstream error, timeout). The
 * two are kept apart because a crawler caches what it is served: telling it
 * "no such analyst" because the backend was busy for a second would freeze that
 * answer into the unfurl for as long as the crawler keeps it.
 */
export type OgRead<T> = { status: "ok"; data: T } | { status: "missing" } | { status: "failed" };

/** GET a public API payload as a read result. Never throws. */
export async function ogFetch<T>(path: string): Promise<OgRead<T>> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      next: { revalidate: REVALIDATE_SECONDS },
    });
    // 422 joins 404 as a permanent miss: it is how the API answers a path
    // parameter that cannot name a row at all (a non-UUID event id), which is
    // as settled an answer as a 404 and reads to a sharer as the same thing.
    if (res.status === 404 || res.status === 422) return { status: "missing" };
    if (!res.ok) return { status: "failed" };
    return { status: "ok", data: (await res.json()) as T };
  } catch {
    return { status: "failed" };
  }
}

/**
 * Connection guard for the avatar leg: reject a host whose name resolves to an
 * address outside the public unicast space, before the socket opens.
 *
 * `isFetchableAvatarUrl` filters the name, which is only half of it. A name is
 * free to point anywhere: `169.254.169.254.nip.io` is a public dotted hostname
 * whose A record is the cloud metadata address. Checking the resolved address
 * is what closes that, and doing it in the connector rather than as a
 * pre-resolve step means the address the guard judged is the address the
 * socket uses.
 *
 * `avatar_url` is server-minted today and only ever names the media host, so
 * this fetch has no owner-controlled destination to reach. The guard stays as
 * defense in depth: it is the card renderer's own floor on where it will open
 * a socket, and it holds whatever a future column or a bad value does.
 *
 * A mixed answer is rejected whole rather than filtered down to its public
 * entries: a host that answers with any private address has no business
 * serving an avatar.
 */
const avatarDispatcher = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      dnsLookup(hostname, { ...options, all: true as const }, (err, addresses) => {
        if (err) {
          callback(err, "", 0);
          return;
        }
        const resolved = addresses as LookupAddress[];
        if (resolved.length === 0 || resolved.some((entry) => isPrivateAddress(entry.address))) {
          callback(new Error(`avatar host ${hostname} does not resolve to a public address`), "", 0);
          return;
        }
        if (options.all) {
          callback(null, resolved);
          return;
        }
        callback(null, resolved[0].address, resolved[0].family);
      });
    },
  },
});

/** `fetch` init plus the two fields the platform adds to it. */
type AvatarRequestInit = RequestInit & { dispatcher: Agent };

/**
 * Read a response body under a running byte budget, or `null` past the ceiling.
 *
 * Buffering first and measuring after would let a host spend the renderer's
 * memory on a body the guard was always going to reject, so the budget is
 * checked per chunk and the stream is dropped the moment it is passed.
 */
async function readCapped(body: ReadableStream<Uint8Array> | null, max: number) {
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > max) return null;
      chunks.push(value);
    }
  } finally {
    // A no-op once the body ended; on the over-budget exit it is what closes
    // the socket instead of leaving the rest of the body arriving.
    await reader.cancel().catch(() => {});
  }
  return total === 0 ? null : Buffer.concat(chunks);
}

/**
 * Fetch an analyst's avatar and inline it as a data URI, or `null` to fall back
 * to the monogram.
 *
 * Inlined rather than handed to Satori as a remote `<img src>` so the fetch
 * carries this module's guards: `isFetchableAvatarUrl` on the host and
 * `isPrivateAddress` on what it resolves to (the URL is a free-form profile
 * field, see `lib/og.ts`), no redirect following (a public host must not be
 * able to bounce the renderer onto a private one), a timeout, a size ceiling
 * enforced as the body arrives, and a decodable content type. Every rejection
 * is silent: a share card degrades, it does not fail.
 */
export async function ogAvatarDataUri(url: string | null | undefined): Promise<string | null> {
  if (!isFetchableAvatarUrl(url)) return null;
  try {
    const res = await fetch(url as string, {
      signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS),
      redirect: "error",
      next: { revalidate: REVALIDATE_SECONDS },
      dispatcher: avatarDispatcher,
    } as AvatarRequestInit);
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!AVATAR_TYPES.includes(contentType)) return null;
    // A declared length over the ceiling is refused before a byte of body is
    // read; an absent or lying header falls through to the running budget.
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > AVATAR_MAX_BYTES) return null;
    const body = await readCapped(res.body, AVATAR_MAX_BYTES);
    if (!body) return null;
    return `data:${contentType};base64,${body.toString("base64")}`;
  } catch {
    return null;
  }
}
