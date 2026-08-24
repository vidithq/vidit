/**
 * Reading the original out of a replay URL, so the paste field can warn about an
 * obvious mis-paste.
 *
 * The server checks where a snapshot lives (`services/source_archive.
 * validate_snapshot`: https, an allowed provider host, that provider's path
 * shape) and never what it captured. The short-code and id forms embed nothing
 * to compare, and the embedded original in the replay forms is not compared
 * server side because it spells the link as the platform did at capture time, so
 * a server-side comparison refuses correct snapshots every time a platform moves
 * its own URLs.
 *
 * What is left is a courtesy: the analyst pasting a replay URL under the wrong
 * field is told before they post. Every function here is therefore deliberately
 * loose. It refuses nothing, so a comparison it cannot make confidently reports
 * "no warning" rather than guessing, and the folds below can be added to freely.
 */

/** The Wayback Machine's host, and the host `ArchivedCopies` prefills its Save
 *  Page Now door on. Mirrors the `wayback` entry of
 *  `source_archive.PROVIDER_HOSTS`. */
export const WAYBACK_HOST = "web.archive.org";

/** archive.today's six interchangeable domains, which serve one set of
 *  snapshots; which one an analyst is handed depends on where they are. Mirrors
 *  the `archive_today` entries of `source_archive.PROVIDER_HOSTS`, and is what
 *  `ArchivedCopies` builds its own host list from. */
export const ARCHIVE_TODAY_HOSTS = [
  "archive.today",
  "archive.ph",
  "archive.is",
  "archive.md",
  "archive.li",
  "archive.vn",
];

/** A Wayback replay path, `/web/<timestamp>/<original url>`, with the optional
 *  replay modifier the player appends to the timestamp. Mirrors
 *  `source_archive._WAYBACK_REPLAY_RE`; this side reads the captured link out of
 *  it, the server side only asks whether the path is one. */
const REPLAY_PATH_RE = /^\/web\/\d{4,14}(?:[a-z]{2}_)?\/(.+)$/i;

/** archive.today's long capture path, `/<timestamp>/<original url>`, which
 *  embeds the original exactly as a replay path does. Mirrors
 *  `source_archive._ARCHIVE_TODAY_CAPTURE_RE`. The service's other spelling is a
 *  short code (`/<code>`), which embeds nothing and matches nothing here. */
const CAPTURE_PATH_RE = /^\/\d{4,14}\/(.+)$/;

/**
 * The link a snapshot URL says it captured, or null when the value embeds none.
 *
 * Two providers spell a capture as `<timestamp>/<original url>`: the Wayback
 * Machine under `/web/`, archive.today at the path root. A short code and a
 * Ghostarchive id carry nothing to read, so they answer null and warn about
 * nothing.
 *
 * The captured link is a whole URL sitting in a path segment, so its own query
 * and fragment were parsed off the snapshot URL and are put back here.
 */
function replayedLink(snapshot: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(snapshot.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  // The URL parser percent-encodes what a pasted path did not, and leaves an
  // invalid percent sequence in place, which `decodeURI` throws on. A path it
  // cannot decode is read raw rather than crashing the field it renders under.
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

/**
 * One link reduced to what two spellings of it have in common: host, path and
 * the query that identifies the page. Null when the value is not an `http(s)`
 * URL, which is the "cannot tell" answer.
 *
 * The scheme, the host case, a leading `www.` and a trailing slash come off,
 * because a link travelling through a browser and an archiving crawler picks up
 * and loses all four. On top of that the platform folds: an analyst's source URL
 * and the URL an archiving crawler settled on routinely name one post under two
 * of a platform's own domains.
 */
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

  // X kept both of its former domains resolving to the renamed one.
  if (host === "twitter.com" || host === "mobile.twitter.com") host = "x.com";
  // X's share sheet appends `s` and `t` to the URL it hands out, and neither
  // names a post: the status id in the path is the whole identity. Keeping them
  // would read a shared spelling of a post and the post itself as two links,
  // which is the shape most of this catalog's sources arrive in.
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
  // YouTube addresses one video by a short share link and by a watch URL whose
  // playlist and timestamp parameters name no other video, so the video id is
  // the whole identity on either spelling.
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

/**
 * The link a pasted snapshot appears to archive, when that is visibly not the
 * link it was pasted under. Null means no warning: the paste embeds no original,
 * the two sides agree, or one of them cannot be read.
 *
 * Nothing here refuses a paste. The form shows the answer as a line under the
 * field and posts the value either way, which is why the comparison may be as
 * loose as it likes: the cost of a wrong warning is a sentence the analyst
 * ignores, and the cost of a missed one is what the server already accepts.
 */
export function snapshotArchivesAnotherLink(link: string, snapshot: string): string | null {
  const replayed = replayedLink(snapshot);
  if (replayed === null) return null;
  const captured = canonicalLink(replayed);
  const wanted = canonicalLink(link);
  if (captured === null || wanted === null) return null;
  return captured === wanted ? null : replayed;
}
