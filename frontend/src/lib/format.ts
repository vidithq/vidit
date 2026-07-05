/**
 * Format a date string (ISO or datetime) to "28 Mar 2026" format.
 */
export function formatDate(input: string): string {
  const date = new Date(input);
  if (isNaN(date.getTime())) return input;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Format a UTC instant (ISO datetime) as "28 Mar 2026, 14:30 UTC". Returns
 * the placeholder dash when `iso` is null (an unknown source post time, e.g.
 * a machine detection with no dated source): `new Date(null)` resolves to
 * the 1970 epoch instead of an invalid date, so the null case needs an
 * explicit check rather than relying on `isNaN(d.getTime())`.
 */
export function formatInstant(iso: string | null): string {
  if (iso === null) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
  return `${date}, ${time} UTC`;
}

/**
 * An ISO instant → the value an `<input type="datetime-local">` expects
 * ("YYYY-MM-DDTHH:MM"), in UTC. Empty string on `null` or an unparseable
 * input (see `formatInstant` on why `null` needs its own check ahead of the
 * `new Date` parse).
 */
export function toDatetimeLocalUTC(iso: string | null): string {
  if (iso === null) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 16);
}

/**
 * Extract the hostname from a URL. Falls back to the raw input
 * if the URL is malformed (avoids throwing in render).
 */
export function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
