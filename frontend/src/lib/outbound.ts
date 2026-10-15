import { SNAPSHOT_HOSTS } from "./snapshots";

/** Vidit's own domain: a link to it, or to a subdomain, stays in the app. */
export const VIDIT_HOST = "vidit.app";

/** Hosts a reader reaches in one click. Every other host asks first (`<OutboundLink>`). A bare
 *  host also covers its subdomains, so add the narrowest host that fits. An entry with a path
 *  covers that exact host and path only: `www.google.com` whole would let `/url?q=` bounce a
 *  one-click link anywhere. Never add a host that serves an open redirector on any path. */
const KNOWN_HOSTS: readonly string[] = [
  ...SNAPSHOT_HOSTS,
  "x.com",
  "twitter.com",
  "t.me",
  "youtube.com",
  "youtu.be",
  "github.com",
  "discord.gg",
  "www.google.com/maps",
  "vercel.com",
  "railway.com",
  "aws.amazon.com",
];

function parseHttp(href: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.hostname ? parsed : null;
}

/** The lowercase hostname of an http(s) URL, or null for anything else. */
export function httpHostname(href: string): string | null {
  return parseHttp(href)?.hostname ?? null;
}

/** True when `hostname` is `host` or one of its subdomains. Compared on whole labels, so
 *  `x.com.evil.example` and `notx.com` are foreign. */
function onHost(hostname: string, host: string): boolean {
  return hostname === host || hostname.endsWith(`.${host}`);
}

function isKnown(url: URL, entry: string): boolean {
  const slash = entry.indexOf("/");
  if (slash === -1) return onHost(url.hostname, entry);
  return url.hostname === entry.slice(0, slash) && url.pathname === entry.slice(slash);
}

type LinkKind = "internal" | "known" | "unknown";

/** How a link renders: `internal` routes in the app, `known` opens in one click, `unknown` asks
 *  first, null is not an http(s) link and renders as text. */
export function linkKind(href: string): LinkKind | null {
  const url = parseHttp(href);
  if (!url) return null;
  // The parser turns `\` into `/`, and the router reads a path starting `//` as another host.
  if (onHost(url.hostname, VIDIT_HOST)) {
    return url.pathname.startsWith("//") ? "unknown" : "internal";
  }
  return KNOWN_HOSTS.some((entry) => isKnown(url, entry)) ? "known" : "unknown";
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"]+/gi;
// Sentence punctuation that follows a URL in prose rather than ending it.
const TRAILING_PUNCTUATION = /[.,;:!?'")\]]+$/;

type TextSegment = { text: string; href?: string };

/** Plain text cut into runs, each http(s) URL in it a run carrying `href`. Trailing sentence
 *  punctuation stays text, and a candidate that does not parse stays text. */
export function splitLinks(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let rest = 0;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const url = match[0].replace(TRAILING_PUNCTUATION, "");
    if (!url || !httpHostname(url)) continue;
    const start = match.index;
    if (start > rest) segments.push({ text: text.slice(rest, start) });
    segments.push({ text: url, href: url });
    rest = start + url.length;
  }
  if (rest < text.length) segments.push({ text: text.slice(rest) });
  return segments;
}
