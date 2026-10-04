import { redirect } from "next/navigation";

/** The archive guide is a section of `/import`; this route keeps published links working. */
export default function ArchiveGuideRedirect() {
  redirect("/import#archive");
}
