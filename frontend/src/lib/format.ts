export function formatDate(input: string): string {
  const date = new Date(input);
  if (isNaN(date.getTime())) return input;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
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

/** A UTC instant as "28 Mar 2026, 14:30 UTC"; the placeholder dash for null. `new Date(null)`
 * is the 1970 epoch, not invalid, so null needs its own check. */
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

/** An ISO instant as the UTC value an `<input type="datetime-local">` expects
 * ("YYYY-MM-DDTHH:MM"); empty on null or unparseable input. */
export function toDatetimeLocalUTC(iso: string | null): string {
  if (iso === null) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 16);
}

/** Hostname of a URL, or the raw input when malformed (never throws in render). */
export function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
