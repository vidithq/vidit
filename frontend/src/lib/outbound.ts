import { SNAPSHOT_HOSTS } from "./snapshots";

/** Vidit's own domain: a link to it, or to a subdomain, stays in the app. */
export const VIDIT_HOST = "vidit.app";

/** Hosts a reader reaches in one click. Every other host asks first (`<OutboundLink>`). An entry
 *  also covers its subdomains, so add the narrowest host that fits: `www.google.com`, not
 *  `google.com`, which would cover `sites.google.com` and the pages anyone publishes there. */
const KNOWN_HOSTS: readonly string[] = [
  ...SNAPSHOT_HOSTS,
  "x.com",
  "twitter.com",
  "t.me",
  "youtube.com",
  "youtu.be",
  "github.com",
  "discord.gg",
  "www.google.com",
  "vercel.com",
  "railway.com",
  "aws.amazon.com",
];

/** The lowercase hostname of an http(s) URL, or null for anything else. */
export function httpHostname(href: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.hostname || null;
}

/** True when `hostname` is `host` or one of its subdomains. Compared on whole labels, so
 *  `x.com.evil.example` and `notx.com` are foreign. */
function onHost(hostname: string, host: string): boolean {
  return hostname === host || hostname.endsWith(`.${host}`);
}

type LinkKind = "internal" | "known" | "unknown";

/** How a link renders: `internal` routes in the app, `known` opens in one click, `unknown` asks
 *  first, null is not an http(s) link and renders as text. */
export function linkKind(href: string): LinkKind | null {
  const hostname = httpHostname(href);
  if (!hostname) return null;
  if (onHost(hostname, VIDIT_HOST)) return "internal";
  return KNOWN_HOSTS.some((host) => onHost(hostname, host)) ? "known" : "unknown";
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
