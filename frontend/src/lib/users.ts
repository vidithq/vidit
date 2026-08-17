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
 * rule). `monthly_activity` is always 12 zero-filled buckets, oldest first.
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

const SOCIAL_HANDLE_BASES: Record<"x" | "github", string> = {
  x: "https://x.com/",
  github: "https://github.com/",
};

const SOCIAL_HANDLE_PATTERN: Record<"x" | "github", RegExp> = {
  // 1–15 chars, alphanumeric + underscore — the platform rule, so a typo
  // like "@some user" doesn't auto-link to a nonsense URL.
  x: /^[A-Za-z0-9_]{1,15}$/,
  // Up to 39 chars, alphanumeric + hyphen. Leading/trailing hyphens aren't
  // rejected: a near-miss should fall back to plain text, not block.
  github: /^[A-Za-z0-9-]{1,39}$/,
};

/**
 * Resolve a per-platform link value to a clickable href, or `null` to
 * render as plain text. Handles three cases:
 *
 *  - Full URL pasted → use it (after the `asHttpUrl` safety sniff).
 *  - X / GitHub bare handle (`@me` or `me`) → expand to the canonical
 *    profile URL on that platform.
 *  - Anything else (Discord username, a non-URL Website value, an
 *    invalid handle shape) → null, render as plain text.
 */
export function resolveLinkHref(
  platform: "x" | "discord" | "website" | "github",
  value: string | null | undefined
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const direct = asHttpUrl(trimmed);
  if (direct) return direct;

  // Bare-handle resolution. Discord has no canonical web URL for a handle,
  // and Website only accepts a full URL — both fall through to non-clickable.
  if (platform === "x" || platform === "github") {
    const handle = trimmed.replace(/^@/, "");
    if (SOCIAL_HANDLE_PATTERN[platform].test(handle)) {
      return `${SOCIAL_HANDLE_BASES[platform]}${handle}`;
    }
  }
  return null;
}
