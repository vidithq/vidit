import { Fragment } from "react";
import Link from "next/link";

import { Avatar } from "@/components/ui/Avatar";
import { TEXT_LINK } from "@/components/ui/styles";
import { cn } from "@/lib/cn";

type Author = {
  username: string;
  avatar_url?: string | null;
};

/** What goes before the name at `index` in a credit line of `count` names: nothing, a comma, or
 *  " and " before the last ("ana, bo and cy"). Shared with the card byline in `EntityCard`. */
export function creditSeparator(index: number, count: number): string {
  if (index === 0) return "";
  return index === count - 1 ? " and " : ", ";
}

/**
 * The "by user" assembly for the detail subtitles, the map side panel header
 * and the detail body's Author row. Text size and colour stay at the call site;
 * `size` scales the gap for the dense panel header; `avatar` leads with the
 * profile picture where the byline is the page's author signature.
 *
 * `coAuthors` credits more analysts after `author` ("by ana, bo and cy"), each
 * with the same avatar and link treatment: the credit line of an event several
 * geolocators share.
 *
 * `link={false}` drops the anchor for a slot that is itself one click: a row
 * under a stretched link cannot hold a second link (a separate keyboard stop).
 */
export function AuthorByline({
  author,
  coAuthors = [],
  prefix = true,
  size = "sm",
  avatar = false,
  link = true,
  className = "",
}: {
  author: Author;
  /** Credited beside `author`, in order. */
  coAuthors?: Author[];
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
  const gap = size === "xs" ? "gap-1" : "gap-1.5";
  const names = [author, ...coAuthors];
  return (
    <span className={cn("inline-flex items-center", gap, className)}>
      {prefix && !avatar && <>by </>}
      {/* Inline flow, not flex: a flex item trims the spaces around " and ". */}
      <span>
        {names.map((person, index) => (
          <Fragment key={person.username}>
            {creditSeparator(index, names.length)}
            <span className={cn("inline-flex items-center", gap)}>
              {avatar && (
                <Avatar
                  as="span"
                  src={person.avatar_url}
                  username={person.username}
                  size={size === "xs" ? "size-4 text-[9px]" : "size-5 text-[10px]"}
                />
              )}
              {link ? (
                <Link href={`/profile/${person.username}`} className={TEXT_LINK}>
                  {person.username}
                </Link>
              ) : (
                <span>{person.username}</span>
              )}
            </span>
          </Fragment>
        ))}
      </span>
    </span>
  );
}
