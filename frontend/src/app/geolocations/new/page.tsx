import { redirect } from "next/navigation";

/**
 * Submit moved to `/submit` (one unified form: fill what you have, then publish
 * a geolocation or post a request). This legacy route redirects, preserving the
 * query so deep links like `?request_id=…` (fulfilment) and `?import=1` (the
 * archive on-ramp) keep working.
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
