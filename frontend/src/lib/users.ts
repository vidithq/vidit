import { apiFetch } from "./api";
import type { components } from "./api-types";
import type { ExternalLinks, User } from "@/types";

/** Payload for `PATCH /users/me`. `undefined` omits (preserves the column); `null` or an
 *  empty string clears it (`model_dump(exclude_unset=True)`). `external_links` is replaced
 *  wholesale. No `avatar_url`: the backend body is `extra=forbid`, so sending one 422s. */
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

/** Upload a profile picture. The backend strips metadata and stores one JPEG on our own
 *  media host, so viewers never load an owner-chosen address. `FormData`: `apiFetch` leaves
 *  the boundary header to the browser and still attaches the CSRF token. */
export function uploadMyAvatar(file: File): Promise<User> {
  const body = new FormData();
  body.append("file", file);
  return apiFetch<User>("/users/me/avatar", { method: "PUT", body });
}

export function deleteMyAvatar(): Promise<User> {
  return apiFetch<User>("/users/me/avatar", { method: "DELETE" });
}

/** Shape of `GET /users/{username}`. Aliased from the generated `UserProfile`, except
 *  `external_links`, kept as the narrow per-platform `ExternalLinks`. */
export type PublicProfile = Omit<
  components["schemas"]["UserProfile"],
  "external_links"
> & { external_links: ExternalLinks };

/** Shape of `GET /users/{username}/stats`. Every field describes the analyst's live
 *  `geolocated` and `detected` events: `activity` is one zero-filled bucket per month, oldest
 *  first; `source_hosts` + `other_hosts_count` + `no_source_count` add up to `total_events`. */
export type UserStats = components["schemas"]["UserStatsRead"];

export function getUserStats(username: string): Promise<UserStats> {
  return apiFetch<UserStats>(`/users/${encodeURIComponent(username)}/stats`);
}

/** Security: `<a href>` is only safe if the destination parses as http(s). Auto-links pasted
 *  URLs, keeps handle-style values (`@me`, `me#1234`) as text, and keeps `javascript:` out
 *  of anchor targets. */
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
    // Not a parsable URL: render as text.
  }
  return null;
}

/** Hosts whose URLs name a profile on the platform, canonical first (a parsed handle links
 *  to it); bare hosts only, the parser folds `www.`. Mirrors `schemas/user.SOCIAL_PROFILE_HOSTS`;
 *  change both. */
const SOCIAL_HOSTS: Record<"x" | "github", readonly string[]> = {
  x: ["x.com", "twitter.com"],
  github: ["github.com"],
};

/** Each platform's account-name rule. Mirrors `schemas/user.SOCIAL_HANDLE_PATTERNS`; change
 *  both. A value the platform would refuse neither links nor prints as a handle. */
const SOCIAL_HANDLE_PATTERN: Record<"x" | "github", RegExp> = {
  x: /^[A-Za-z0-9_]{1,15}$/,
  github: /^[A-Za-z0-9-]{1,39}$/,
};

/** The account a stored X or GitHub value names, or `{ handle: null }`; the href and the
 *  printed text both run off this parse. Two forms pass: a bare handle (`ana`, `@ana`), and a
 *  profile URL on the platform's own hosts with exactly one path segment. Compared on
 *  `hostname` (`x.com.evil.example` is foreign). Status URLs, product paths, queries and
 *  fragments carry more than an account; a URL segment is read literally (`/@ana` is not
 *  `ana`). */
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

/** Resolve a link value to a clickable href, or `null`. X and GitHub build the canonical
 *  profile URL from the account the value names (a foreign host resolves to nothing, so a
 *  brand mark never points at someone else's server). Website passes the `asHttpUrl` sniff
 *  (keeps `javascript:` out of the DOM). Discord has no profile URL. */
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

/** The text to print for a link value (the href stays `resolveLinkHref`'s). X and GitHub
 *  print the handle with `@`; Website drops the scheme and trailing slash; anything else
 *  prints as stored, since only its owner can vouch for it. */
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
