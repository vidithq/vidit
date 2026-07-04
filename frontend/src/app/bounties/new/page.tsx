import { redirect } from "next/navigation";

/**
 * Legacy redirect: request creation lives on the unified submit page. Kept so
 * old `/bounties/new` links keep working.
 */
export default function LegacyNewBountyRedirect() {
  redirect("/submit");
}
