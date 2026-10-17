import { Fragment } from "react";
import Link from "next/link";

import { Avatar } from "@/components/ui/Avatar";
import { Tooltip } from "@/components/ui/Tooltip";
import { TEXT_LINK } from "@/components/ui/styles";
import { cn } from "@/lib/cn";
import { profileHref } from "@/lib/routes";

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
 * `coAuthors` credits more analysts after `author`, side by side: the credit
 * line of an event several geolocators share. By default each is its picture
 * and name, and with more than one name every name shows its picture, `avatar`
 * or not. `coAuthorsAs="avatars"` keeps the lead as picture and name and shows
 * each co-author as a picture alone, named by its handle and showing it in a
 * `<Tooltip>`: the feed cards and the event page header.
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
  coAuthorsAs = "names",
  prefix = true,
  size = "sm",
  avatar = false,
  link = true,
  className = "",
}: {
  author: Author;
  /** Credited beside `author`, in order. */
  coAuthors?: Author[];
  /** `avatars` shows each co-author as a picture alone, its handle in a tooltip. */
  coAuthorsAs?: "names" | "avatars";
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
  const pictureSize = size === "xs" ? "size-4 text-[9px]" : "size-5 text-[10px]";
  const picture = (person: Author) => (
    <Avatar
      as="span"
      src={person.avatar_url}
      username={person.username}
      decorative
      size={pictureSize}
    />
  );
  const href = (person: Author) => person.href ?? profileHref(person.username);
  return (
    <span className={cn("inline-flex items-center", gap, className)}>
      {prefix && !avatar && <>by </>}
      <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {names.map((person, index) => (
          <Fragment key={person.username}>
            <CreditSeparator index={index} count={names.length} />
            {index > 0 && coAuthorsAs === "avatars" ? (
              <Tooltip label={person.username}>
                {link ? (
                  <Link href={href(person)} aria-label={person.username} className="flex rounded-full">
                    {picture(person)}
                  </Link>
                ) : (
                  <span role="img" aria-label={person.username} className="flex">
                    {picture(person)}
                  </span>
                )}
              </Tooltip>
            ) : (
              <span className={cn("inline-flex items-center", gap)}>
                {pictures && picture(person)}
                {link ? (
                  <Link href={href(person)} className={TEXT_LINK}>
                    {person.username}
                  </Link>
                ) : (
                  <span>{person.username}</span>
                )}
              </span>
            )}
          </Fragment>
        ))}
      </span>
    </span>
  );
}
