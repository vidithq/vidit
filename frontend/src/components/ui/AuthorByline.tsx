import Link from "next/link";

import { Avatar } from "@/components/ui/Avatar";
import { TEXT_LINK } from "@/components/ui/styles";
import { cn } from "@/lib/cn";

/**
 * The "by @user" assembly for the detail subtitles, the map side panel header
 * and the detail body's Author row. Text size and colour stay at the call site;
 * `size` scales the gap for the dense panel header; `avatar` leads with the
 * profile picture where the byline is the page's author signature.
 *
 * `link={false}` drops the anchor for a slot that is itself one click: a row
 * under a stretched link cannot hold a second link (a separate keyboard stop).
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
  /** The leading "by ". Off where a label already says it. */
  prefix?: boolean;
  /** `xs` is the dense map-panel header (smaller gap). */
  size?: "sm" | "xs";
  /** Lead with the avatar; implies no "by " prefix. */
  avatar?: boolean;
  /** Off inside a row that is already one click. */
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
