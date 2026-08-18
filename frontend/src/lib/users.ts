import { apiFetch } from "./api";
import type { components } from "./api-types";
import type { ExternalLinks, User } from "@/types";

/**
 * Payload for `PATCH /users/me`.
 *
 * `undefined` means "omit" (preserve the column); explicit `null` or empty
 * string means "clear it" — the backend distinguishes via
 * `model_dump(exclude_unset=True)`. `external_links` is wholesale-replaced:
 * send the full object, omitted platforms are dropped.
 *
 * No `avatar_url`: the column is server-minted and only the avatar endpoints
 * below write it. The backend body is `extra=forbid`, so sending one 422s.
 */
export interface UserProfileUpdate {
  bio?: string | null;
  external_links?: ExternalLinks | null;
}

export function updateMyProfile(body: UserProfileUpdate): Promise<User> {
  return apiFetch<User>("/users/me", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/**
 * Upload a profile picture. The backend strips its metadata, resizes it, and
 * stores one JPEG on our own media host, so the avatar every viewer's browser
 * loads is never an address the profile owner chose.
 *
 * `FormData` rather than JSON: `apiFetch` leaves the boundary header to the
 * browser and still attaches the CSRF token.
 */
export function uploadMyAvatar(file: File): Promise<User> {
  const body = new FormData();
  body.append("file", file);
  return apiFetch<User>("/users/me/avatar", { method: "PUT", body });
}

/** Drop the profile picture; surfaces fall back to the monogram icon. */
export function deleteMyAvatar(): Promise<User> {
  return apiFetch<User>("/users/me/avatar", { method: "DELETE" });
}

/**
 * Shape returned by `GET /users/{username}`. The profile page calls
 * `apiFetch<PublicProfile>(...)` directly rather than via a wrapper.
 *
 * Aliased from the generated `UserProfile`, except `external_links`: the
 * generated field is the column's loose `{[key: string]: string | null}` map,
 * and the profile surfaces key it per platform, so the narrow `ExternalLinks`
 * (itself the generated per-platform schema) is kept here.
 */
export type PublicProfile = Omit<
  components["schemas"]["UserProfile"],
  "external_links"
> & { external_links: ExternalLinks };

/**
 * Shape returned by `GET /users/{username}/stats` — the aggregated
 * shape-of-work payload behind the profile insights section, aliased from
 * the generated OpenAPI types (never hand-written, per the single-source
 * rule). Every field describes one population, the analyst's live events in
 * the three worked statuses: `activity` is one zero-filled bucket per month,
 * oldest first, over the span their own event dates cover, and `source_hosts`
 * plus `other_hosts_count` plus `no_source_count` add up to `total_events`.
 */
export type UserStats = components["schemas"]["UserStatsRead"];

export function getUserStats(username: string): Promise<UserStats> {
  return apiFetch<UserStats>(`/users/${encodeURIComponent(username)}/stats`);
}

/**
 * `<a href>` is only safe if the destination parses as http(s). The link
 * panel renders user-supplied strings; this sniff auto-links pasted URLs,
 * keeps handle-style values (`@me`, `me#1234`) as plain text, and blocks
 * `javascript:` URLs from ever reaching the DOM as an anchor target.
 */
function asHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch {
    // Not a parsable URL — render as text, not an anchor.
  }
  return null;
}

/** The hosts whose URLs name a profile on the platform, canonical first: a
 *  parsed handle links to that first host. The `www.` form of each is folded in
 *  by the parser, so this lists the bare hosts only. Mirrors
 *  `schemas/user.SOCIAL_PROFILE_HOSTS`. */
const SOCIAL_HOSTS: Record<"x" | "github", readonly string[]> = {
  x: ["x.com", "twitter.com"],
  github: ["github.com"],
};

/** Each platform's own account-name rule, mirroring
 *  `schemas/user.SOCIAL_HANDLE_PATTERNS`: 1 to 15 characters of alphanumerics
 *  and underscores for X, up to 39 alphanumerics and hyphens for a GitHub user
 *  or organization. A value the platform itself would refuse is not an account,
 *  so it neither links nor prints as a handle. */
const SOCIAL_HANDLE_PATTERN: Record<"x" | "github", RegExp> = {
  x: /^[A-Za-z0-9_]{1,15}$/,
  github: /^[A-Za-z0-9-]{1,39}$/,
};

/**
 * The account a stored X or GitHub value names, or `{ handle: null }` when it
 * names none. Both helpers below run off this one parse, so what the profile
 * links and what it prints cannot disagree.
 *
 * Two forms pass: a bare handle (`ana`, `@ana`), which is what the backend
 * stores, and a profile URL on the platform's own hosts carrying exactly one
 * path segment, which is the form a value written before that rule can still
 * hold. A URL is compared on its `hostname`, so a host that merely contains the
 * platform's name (`x.com.evil.example`) is a foreign host. A status URL, a
 * product path (`/i/flow`), a query or a fragment all carry more than an
 * account, and a URL segment is read literally: `/@ana` is not the handle
 * `ana`, since the stored form of that account is the handle itself.
 */
function parseSocialLink(
  platform: "x" | "github",
  value: string
): { handle: string | null } {
  const trimmed = value.trim();
  const url = asHttpUrl(trimmed);

  if (url) {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (!SOCIAL_HOSTS[platform].includes(host)) return { handle: null };
    if (parsed.search || parsed.hash) return { handle: null };
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length !== 1) return { handle: null };
    return {
      handle: SOCIAL_HANDLE_PATTERN[platform].test(segments[0])
        ? segments[0]
        : null,
    };
  }

  const handle = trimmed.replace(/^@/, "");
  return { handle: SOCIAL_HANDLE_PATTERN[platform].test(handle) ? handle : null };
}

/**
 * Resolve a per-platform link value to a clickable href, or `null` to render
 * no link at all. Handles three cases:
 *
 *  - X / GitHub → the profile URL for the account the value names, built on the
 *    platform's canonical host. A value naming no account resolves to nothing,
 *    including a URL on a host the platform does not own: a brand mark pointing
 *    at someone else's server is the one thing this row must not do.
 *  - Website → the URL, after the `asHttpUrl` safety sniff, which is what keeps
 *    a `javascript:` value from reaching the DOM as an anchor target.
 *  - Discord → nothing. The platform exposes no profile URL for a username, so
 *    the caller copies it instead.
 */
export function resolveLinkHref(
  platform: keyof ExternalLinks,
  value: string | null | undefined
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (platform === "x" || platform === "github") {
    const { handle } = parseSocialLink(platform, trimmed);
    return handle ? `https://${SOCIAL_HOSTS[platform][0]}/${handle}` : null;
  }
  if (platform === "website") return asHttpUrl(trimmed);
  return null;
}

/**
 * The text to print for a link value, which is not the text to click: the href
 * stays whatever `resolveLinkHref` returns. `https://x.com/LoLManya` spends
 * most of its width saying which platform the icon beside it already said.
 *
 *  - X / GitHub → the handle with an `@`, off the same parse the href runs.
 *  - Website → the URL without its scheme and without a trailing slash, so
 *    `https://osintmethat.com/` reads `osintmethat.com` and a path is kept.
 *  - Discord, and anything that fits none of the above → as stored, because a
 *    value this cannot parse is one only its owner can vouch for.
 */
export function displayLinkValue(
  platform: keyof ExternalLinks,
  value: string | null | undefined
): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";

  if (platform === "x" || platform === "github") {
    const { handle } = parseSocialLink(platform, trimmed);
    return handle ? `@${handle}` : trimmed;
  }

  if (platform === "website") {
    const url = asHttpUrl(trimmed);
    if (url) return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  }

  return trimmed;
}
