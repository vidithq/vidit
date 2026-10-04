import { redirect } from "next/navigation";

/** Legacy route: requests are created on the unified submit page, so this redirects there. */
export default function NewRequestPage() {
  redirect("/submit");
}
