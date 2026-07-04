import { redirect } from "next/navigation";

/**
 * Request creation merged into the unified submit page. A request is an
 * unfinished geolocation, so there is no separate request form: the submit page
 * hosts one form and its "Post as request" action publishes the open call. This
 * route redirects there so existing links and bookmarks keep working.
 */
export default function NewRequestPage() {
  redirect("/submit");
}
