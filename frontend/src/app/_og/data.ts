import { lookup as dnsLookup, type LookupAddress } from "node:dns";

import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from "undici";

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
 *
 * The answer is always asked for whole (`all: true`) so the guard judges every
 * address a name carries, and it is handed back IPv4 first. A serverless
 * runtime without IPv6 egress cannot reach a `2a04:…` address, so an answer
 * that leads with one costs the card its avatar on a host that also publishes
 * an A record. Ordering covers both shapes of the connector's ask: the whole
 * list keeps every address with the reachable one first, and a single-address
 * ask is answered with an IPv4 entry whenever the name has one.
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

/**
 * What a capped body read answers with. `over` and `empty` are kept apart so
 * the warning below names the one that happened.
 */
type CappedRead = { status: "ok"; body: Buffer } | { status: "over" } | { status: "empty" };

/**
 * Read a response body under a running byte budget.
 *
 * Buffering first and measuring after would let a host spend the renderer's
 * memory on a body the guard was always going to reject, so the budget is
 * checked per chunk and the stream is dropped the moment it is passed.
 */
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
    // A no-op once the body ended; on the over-budget exit it is what closes
    // the socket instead of leaving the rest of the body arriving.
    await reader.cancel().catch(() => {});
  }
  return total === 0 ? { status: "empty" } : { status: "ok", body: Buffer.concat(chunks) };
}

/**
 * `host` and path of an avatar URL, for a log line.
 *
 * A query string can carry a signature or a token, so the warning names the
 * host and the path and drops everything after them.
 */
function avatarTarget(value: string | null | undefined): string {
  if (!value) return "(no url)";
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname}`;
  } catch {
    return "(unparsable url)";
  }
}

/**
 * Record why a card fell back to the monogram, and answer `null`.
 *
 * Every rejection on this leg used to be silent, which left a card showing the
 * monogram for an avatar that passes every guard with nothing in the function
 * log to read. The warning is the one place that says which guard, or which
 * error, ended the read.
 */
function skipAvatar(url: string | null | undefined, reason: string): null {
  console.warn(`og avatar skipped: ${reason} (${avatarTarget(url)})`);
  return null;
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
 * enforced as the body arrives, and a decodable content type. A rejection
 * costs the monogram and a warning: a share card degrades, it does not fail.
 *
 * The read goes through the `undici` package's own `fetch` rather than the
 * global one. `dispatcher` is honoured by the undici that owns the `Agent`
 * holding the guard, and the global `fetch` on a serverless runtime is a
 * different, older undici bundled with the runtime: handing it this `Agent`
 * throws, which took the avatar off every card while the guard looked applied.
 * Reading through the same undici that built the `Agent` makes the guard hold
 * on every runtime. This leg carries no data cache (undici's `fetch` has
 * none); the payload reads in `ogFetch` keep theirs, and they are the
 * rate-limit concern.
 */
export async function ogAvatarDataUri(url: string | null | undefined): Promise<string | null> {
  if (!isFetchableAvatarUrl(url)) return skipAvatar(url, "rejected by the URL guard");
  try {
    const res = await undiciFetch(url as string, {
      signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS),
      redirect: "error",
      dispatcher: avatarDispatcher,
    });
    if (!res.ok) return skipAvatar(url, `status ${res.status}`);
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!AVATAR_TYPES.includes(contentType)) {
      return skipAvatar(url, `content type ${contentType || "(none)"} is not decodable`);
    }
    // A declared length over the ceiling is refused before a byte of body is
    // read; an absent or lying header falls through to the running budget.
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > AVATAR_MAX_BYTES) {
      return skipAvatar(url, `declared length ${declared} over the ${AVATAR_MAX_BYTES} byte cap`);
    }
    const read = await readCapped(res.body, AVATAR_MAX_BYTES);
    if (read.status === "over") return skipAvatar(url, `body over the ${AVATAR_MAX_BYTES} byte cap`);
    if (read.status === "empty") return skipAvatar(url, "empty body");
    return `data:${contentType};base64,${read.body.toString("base64")}`;
  } catch (err) {
    return skipAvatar(url, err instanceof Error ? err.message : String(err));
  }
}
