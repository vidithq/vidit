import { Fragment } from "react";
import Link from "next/link";

import { Avatar } from "@/components/ui/Avatar";
import { TEXT_LINK } from "@/components/ui/styles";
import { cn } from "@/lib/cn";

type Author = {
  username: string;
  avatar_url?: string | null;
  /** Where the name links; the analyst's profile by default. */
  href?: string;
};

/** What a screen reader hears before the name at `index` in a credit line of `count` names:
 *  nothing, a comma, or " and " before the last ("ana, bo and cy"). On screen the names stand
 *  apart with no separator. */
function CreditSeparator({ index, count }: { index: number; count: number }) {
  if (index === 0) return null;
  return <span className="sr-only">{index === count - 1 ? " and " : ", "}</span>;
}

/**
 * The "by user" assembly for the detail subtitles, the map side panel header
 * and the detail body's Author row. Text size and colour stay at the call site;
 * `size` scales the gap for the dense panel header; `avatar` leads with the
 * profile picture where the byline is the page's author signature.
 *
 * `coAuthors` credits more analysts after `author`, each as its picture and
 * name, side by side: the credit line of an event several geolocators share.
 * With more than one name every name shows its picture, `avatar` or not.
 *
 * `link={false}` drops the anchor for a slot that is itself one click: a row
 * under a stretched link cannot hold a second link (a separate keyboard stop).
 *
 * A name with its own `href` links there instead of a profile: an organization
 * signs with its name, picture and page (`organizationByline`).
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
  const pictures = avatar || names.length > 1;
  return (
    <span className={cn("inline-flex items-center", gap, className)}>
      {prefix && !avatar && <>by </>}
      <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {names.map((person, index) => (
          <Fragment key={person.username}>
            <CreditSeparator index={index} count={names.length} />
            <span className={cn("inline-flex items-center", gap)}>
              {pictures && (
                <Avatar
                  as="span"
                  src={person.avatar_url}
                  username={person.username}
                  decorative
                  size={size === "xs" ? "size-4 text-[9px]" : "size-5 text-[10px]"}
                />
              )}
              {link ? (
                <Link href={person.href ?? `/profile/${person.username}`} className={TEXT_LINK}>
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
