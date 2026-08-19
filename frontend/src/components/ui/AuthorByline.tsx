import Link from "next/link";

import { Avatar } from "@/components/ui/Avatar";
import { TEXT_LINK } from "@/components/ui/styles";
import { cn } from "@/lib/cn";

/**
 * The "by @user" assembly used by the geolocation and request detail
 * subtitles, the map side panel header, and the detail body's Author row.
 * Text size and colour stay at the call site (a PageShell subtitle already
 * sets both); `size` scales the gap for the dense panel header; `avatar` leads
 * with the author's profile picture where the byline is the page's author
 * signature (the detail-page slots).
 *
 * `link={false}` is the same assembly without its anchor, for a slot that is
 * itself one click: a row covered by a stretched link cannot hold a second
 * link, which a mouse would reach and a keyboard would announce as a separate
 * stop. The handle stays readable and the profile is one tap away from
 * wherever that row leads.
 */
export function AuthorByline({
  author,
  prefix = true,
  size = "sm",
  avatar = false,
  link = true,
  className = "",
}: {
  author: {
    username: string;
    avatar_url?: string | null;
  };
  /** Render the leading "by ". Off for slots whose label already says it
   *  (the detail body's Author row). */
  prefix?: boolean;
  /** `sm`: default; `xs`: the dense map-panel header (smaller gap). */
  size?: "sm" | "xs";
  /** Lead with the author's avatar (initial fallback). Implies no "by "
   *  prefix: picture + handle already read as a signature. */
  avatar?: boolean;
  /** Link the handle to the profile. Off inside a row that is already one
   *  click (a history row's stretched link), where a nested anchor is a
   *  target the mouse and the keyboard disagree about. */
  link?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center",
        size === "xs" ? "gap-1" : "gap-1.5",
        className,
      )}
    >
      {avatar && (
        <Avatar
          as="span"
          src={author.avatar_url}
          username={author.username}
          size={size === "xs" ? "size-4 text-[9px]" : "size-5 text-[10px]"}
        />
      )}
      {prefix && !avatar && <>by </>}
      {link ? (
        <Link href={`/profile/${author.username}`} className={TEXT_LINK}>
          {author.username}
        </Link>
      ) : (
        <span>{author.username}</span>
      )}
    </span>
  );
}
