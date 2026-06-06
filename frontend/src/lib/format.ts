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
