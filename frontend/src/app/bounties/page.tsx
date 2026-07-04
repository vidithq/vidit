import { redirect } from "next/navigation";

/**
 * Legacy redirect: the queue moved from `/bounties` to `/requests` (the product
 * term is now "request"; "bounty" returns if incentives ever do). Kept so old
 * links and bookmarks keep working.
 */
export default function LegacyBountiesRedirect() {
  redirect("/requests");
}
