import { redirect } from "next/navigation";

/**
 * Submit moved to `/submit` (it now hosts both geolocation and bounty
 * creation). This legacy route redirects, preserving the query so deep links
 * like `?bounty_id=…` (fulfilment) and `?type=bounty` keep working.
 */
export default async function LegacyNewGeolocationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") qs.set(key, value);
    else if (Array.isArray(value)) value.forEach((v) => qs.append(key, v));
  }
  const query = qs.toString();
  redirect(`/submit${query ? `?${query}` : ""}`);
}
