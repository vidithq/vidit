import { redirect } from "next/navigation";

/**
 * The bot guide is one section of the single import guide at `/import`, since
 * the bot, the paste and the archive read one engine and the rules were being
 * stated three times. This route stays because the bot's X bio and pinned post
 * point at it, and its failure reply's "Guide in bio" footer resolves through
 * it.
 */
export default function BotGuideRedirect() {
  redirect("/import#bot");
}
