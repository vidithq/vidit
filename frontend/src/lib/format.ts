export function formatDate(input: string): string {
  const date = new Date(input);
  if (isNaN(date.getTime())) return input;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export const DAY_MS = 86_400_000;

/** How long something opened at `since` (an ISO instant) has been open, in whole days:
 * "Open today", "Open 1 day", "Open 12 days". */
export function formatOpenAge(since: string): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / DAY_MS));
  if (days === 0) return "Open today";
  return `Open ${countLabel(days, "day")}`;
}

/** `2026-03` → "Mar 2026"; an unparsable key renders as-is. */
export function formatMonth(period: string): string {
  const [year, month] = period.split("-");
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  if (isNaN(date.getTime())) return period;
  return date.toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The UTC day of an instant, as "28 Mar 2026"; an unparsable value renders as-is. */
export function formatInstantDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** A UTC instant as "28 Mar 2026, 14:30 UTC"; the placeholder dash for null. `new Date(null)`
 * is the 1970 epoch, not invalid, so null needs its own check. */
export function formatInstant(iso: string | null): string {
  if (iso === null) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const date = formatInstantDate(iso);
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
  return `${date}, ${time} UTC`;
}

/** A UTC instant as `formatInstant` does, or as its day alone when it falls exactly on 00:00:00
 * UTC: the API takes a date-only value and stores it at midnight, and nothing records whether a
 * time was given, so midnight reads as "time unknown". */
export function formatInstantOrDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.getTime() % DAY_MS === 0 ? formatInstantDate(iso) : formatInstant(iso);
}

/** A time of day as `HH:MM`: the API serves `HH:MM:SS`, a time input holds `HH:MM`. */
export function hhmm(time: string): string {
  return time.slice(0, 5);
}

/** An ISO instant as the UTC value an `<input type="datetime-local">` expects
 * ("YYYY-MM-DDTHH:MM"); empty on null or unparseable input. */
export function toDatetimeLocalUTC(iso: string | null): string {
  if (iso === null) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 16);
}

/** Hostname of a URL for display, without a leading `www.`; the raw input when malformed (never
 * throws in render). */
export function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function parseHttp(href: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.hostname ? parsed : null;
}

/** `noun` for a count of one, `noun` plus `s` for any other: regular English plurals only. */
export function pluralNoun(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}

/** `count` with thousands grouped and its noun: *1 result*, *1,284 results*. */
export function countLabel(count: number, noun: string): string {
  return `${count.toLocaleString("en-US")} ${pluralNoun(count, noun)}`;
}
