import { redirect } from "next/navigation";

/**
 * Legacy redirect: request detail moved from `/bounties/[id]` to
 * `/requests/[id]`. Kept so old deep links keep resolving.
 */
export default async function LegacyBountyDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/requests/${id}`);
}
