import { API_URL } from "@/lib/api";
import { isFetchableAvatarUrl } from "@/lib/og";

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
 * window trades a few minutes of staleness for not paying a backend round trip
 * per unfurl.
 */
const REVALIDATE_SECONDS = 300;

/** Ceiling on an avatar body, above which the monogram is used instead. */
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Satori decodes these; a `image/webp` or `image/avif` avatar renders as the
 * monogram rather than risking a decode failure that would fail the whole card.
 */
const AVATAR_TYPES = ["image/png", "image/jpeg", "image/gif"];

/** GET a public API payload, or `null` for any miss, error, or timeout. */
export async function ogFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Fetch an analyst's avatar and inline it as a data URI, or `null` to fall back
 * to the monogram.
 *
 * Inlined rather than handed to Satori as a remote `<img src>` so the fetch
 * carries this module's guards: `isFetchableAvatarUrl` on the host (the URL is
 * a free-form profile field, see `lib/og.ts`), no redirect following (a public
 * host must not be able to bounce the renderer onto a private one), a timeout,
 * a size ceiling, and a decodable content type. Every rejection is silent: a
 * share card degrades, it does not fail.
 */
export async function ogAvatarDataUri(url: string | null | undefined): Promise<string | null> {
  if (!isFetchableAvatarUrl(url)) return null;
  try {
    const res = await fetch(url as string, {
      signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS),
      redirect: "error",
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!AVATAR_TYPES.includes(contentType)) return null;
    const body = await res.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > AVATAR_MAX_BYTES) return null;
    return `data:${contentType};base64,${Buffer.from(body).toString("base64")}`;
  } catch {
    return null;
  }
}
