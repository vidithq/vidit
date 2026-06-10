import { apiFetch } from "./api";
import type { ExternalLinks, User } from "@/types";

/**
 * Payload for `PATCH /users/me`.
 *
 * `undefined` means "omit" (preserve the column); explicit `null` or empty
 * string means "clear it" — the backend distinguishes via
 * `model_dump(exclude_unset=True)`. `external_links` is wholesale-replaced:
 * send the full object, omitted platforms are dropped.
 */
export interface UserProfileUpdate {
  bio?: string | null;
  avatar_url?: string | null;
  external_links?: ExternalLinks | null;
}

export function updateMyProfile(body: UserProfileUpdate): Promise<User> {
  return apiFetch<User>("/users/me", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/**
 * Shape returned by `GET /users/{username}`. The profile page calls
 * `apiFetch<PublicProfile>(...)` directly rather than via a wrapper so the
 * admin trust-toggle path can refetch the same shape without a second helper.
 */
export interface PublicProfile {
  id: string;
  username: string;
  is_trusted: boolean;
  trust_reason: string | null;
  bio: string | null;
  avatar_url: string | null;
  external_links: ExternalLinks;
  created_at: string;
  geolocations_count: number;
  followers_count: number;
  following_count: number;
  is_following: boolean;
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

  // A pasted full URL takes priority.
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
