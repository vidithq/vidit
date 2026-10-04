/**
 * Reads the original out of a replay URL so the paste field can warn about an obvious
 * mis-paste. The server checks where a snapshot lives (`services/source_archive.
 * validate_snapshot`) and never what it captured: the embedded original spells the link as
 * the platform did at capture time, so a server comparison would refuse correct snapshots
 * whenever a platform moves its URLs. Everything here is a loose courtesy: it refuses
 * nothing and reports "no warning" when it cannot compare confidently.
 */

/** Mirrors the `wayback` entry of `source_archive.PROVIDER_HOSTS`; change both.
 *  `ArchivedCopies` prefills its Save Page Now door on it. */
export const WAYBACK_HOST = "web.archive.org";

/** archive.today's six interchangeable domains (one set of snapshots). Mirrors the
 *  `archive_today` entries of `source_archive.PROVIDER_HOSTS`; change both. `ArchivedCopies`
 *  builds its host list from it. */
export const ARCHIVE_TODAY_HOSTS = [
  "archive.today",
  "archive.ph",
  "archive.is",
  "archive.md",
  "archive.li",
  "archive.vn",
];

/** Wayback replay path `/web/<timestamp>/<original url>`, optional replay modifier included.
 *  Mirrors `source_archive._WAYBACK_REPLAY_RE`; change both. The server only checks the
 *  shape, this side reads the link out. */
const REPLAY_PATH_RE = /^\/web\/\d{4,14}(?:[a-z]{2}_)?\/(.+)$/i;

/** archive.today's long capture path `/<timestamp>/<original url>`. Mirrors
 *  `source_archive._ARCHIVE_TODAY_CAPTURE_RE`; change both. The short code form embeds
 *  nothing and matches nothing. */
const CAPTURE_PATH_RE = /^\/\d{4,14}\/(.+)$/;

/** The link a snapshot URL says it captured, or null when it embeds none (short codes,
 *  Ghostarchive ids). The captured link's own query and fragment were parsed off the
 *  snapshot URL and are put back. */
function replayedLink(snapshot: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(snapshot.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  // `decodeURI` throws on an invalid percent sequence; read the raw path rather than crash the field.
  let path = parsed.pathname;
  try {
    path = decodeURI(path);
  } catch {
    // Keep the encoded path.
  }
  const pattern =
    host === WAYBACK_HOST
      ? REPLAY_PATH_RE
      : ARCHIVE_TODAY_HOSTS.includes(host)
        ? CAPTURE_PATH_RE
        : null;
  const match = pattern?.exec(path);
  return match ? `${match[1]}${parsed.search}${parsed.hash}` : null;
}

/** One link reduced to what two spellings share: host, path and identifying query; null
 *  when not http(s) ("cannot tell"). The scheme, host case, leading `www.` and trailing slash
 *  come off, then platform folds (one post under two of a platform's domains). */
function canonicalLink(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  let host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  let path = parsed.pathname.replace(/\/+$/, "");
  let query = parsed.search;

  // X's former domains resolve to the renamed one.
  if (host === "twitter.com" || host === "mobile.twitter.com") host = "x.com";
  // X's share sheet appends `s` and `t`; neither names a post, so keeping them would read a
  // shared spelling and the post itself as two links.
  if (host === "x.com") {
    const params = new URLSearchParams(query);
    params.delete("s");
    params.delete("t");
    const kept = params.toString();
    query = kept ? `?${kept}` : "";
  }
  // Telegram's long domain and its `/s/` channel preview address the same post.
  if (host === "telegram.me") host = "t.me";
  if (host === "t.me" && path.startsWith("/s/")) path = path.slice(2);
  if (host === "m.youtube.com") host = "youtube.com";
  // A short share link and a watch URL with playlist/timestamp params name one video: the id
  // is the identity.
  const videoId =
    host === "youtu.be" && path.length > 1
      ? path.slice(1)
      : host === "youtube.com" && path === "/watch"
        ? parsed.searchParams.get("v")
        : null;
  if (videoId) {
    host = "youtube.com";
    path = "/watch";
    query = `?v=${videoId}`;
  }

  return `${host}${path}${query}`;
}

/** The link a pasted snapshot appears to archive, when visibly not the link it was pasted
 *  under; null means no warning. Nothing refuses a paste, so a wrong warning costs an
 *  ignored sentence. */
export function snapshotArchivesAnotherLink(link: string, snapshot: string): string | null {
  const replayed = replayedLink(snapshot);
  if (replayed === null) return null;
  const captured = canonicalLink(replayed);
  const wanted = canonicalLink(link);
  if (captured === null || wanted === null) return null;
  return captured === wanted ? null : replayed;
}
