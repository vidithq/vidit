import { redirect } from "next/navigation";

/**
 * Bounty creation merged into the unified submit page — a bounty is an
 * unfinished geolocation, and the two forms shared most of their fields. This
 * route now redirects to the submit page in bounty mode so existing links and
 * bookmarks keep working.
 */
export default function NewBountyPage() {
  redirect("/submit?type=bounty");
}
