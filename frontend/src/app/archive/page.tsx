import { redirect } from "next/navigation";

/**
 * The archive guide is one section of the single import guide at `/import`,
 * since the bot, the paste and the archive read one engine and the rules were
 * being stated three times. This route stays for the links already published
 * against it.
 */
export default function ArchiveGuideRedirect() {
  redirect("/import#archive");
}
