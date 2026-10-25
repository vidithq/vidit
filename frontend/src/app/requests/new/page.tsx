import { redirect } from "next/navigation";

import { submitHref } from "@/lib/routes";

/** Legacy route: requests are created on the unified submit page, so this opens its form. */
export default function NewRequestPage() {
  redirect(submitHref("single"));
}
