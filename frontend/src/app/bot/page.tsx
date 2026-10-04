import { redirect } from "next/navigation";

/** The bot guide is a section of `/import`; this route stays because the bot's X bio, pinned post and failure reply link to it. */
export default function BotGuideRedirect() {
  redirect("/import#bot");
}
