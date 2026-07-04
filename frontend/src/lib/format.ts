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
 * Format a UTC instant (ISO datetime) as "28 Mar 2026, 14:30 UTC".
 */
export function formatInstant(iso: string): string {
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
 * ("YYYY-MM-DDTHH:MM"), in UTC. Empty string on an unparseable input.
 */
export function toDatetimeLocalUTC(iso: string): string {
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
