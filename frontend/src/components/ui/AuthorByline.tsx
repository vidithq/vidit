import { Fragment } from "react";
import Link from "next/link";

import { Avatar } from "@/components/ui/Avatar";
import { AvatarStack } from "@/components/ui/AvatarStack";
import { TEXT_LINK } from "@/components/ui/styles";
import { cn } from "@/lib/cn";
import { profileHref } from "@/lib/routes";

type Author = {
  username: string;
  avatar_url?: string | null;
  /** Where the name links; the analyst's profile by default. */
  href?: string;
};

/** The gap between the names of a credit line, and between the lead and the co-authors'
 *  pictures: the page byline and the form's managed byline (`useGeolocatorsByline`) share it,
 *  so the two line up. */
export const BYLINE_GAP = "gap-x-2 gap-y-1";

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
 * the co-authors as an `<AvatarStack>` (`sm`, or `xs` on a card), each picture
 * named by its handle and showing it in a tooltip: the feed cards and the event
 * page header, which the form's managed byline repeats picture for picture.
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
  const name = (person: Author) => (
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
  );
  return (
    <span className={cn("inline-flex items-center", gap, className)}>
      {prefix && !avatar && <>by </>}
      <span className={cn("inline-flex flex-wrap items-center", BYLINE_GAP)}>
        {coAuthorsAs === "avatars" ? (
          <>
            {name(author)}
            <AvatarStack
              items={coAuthors.map((person) => ({
                key: person.username,
                name: person.username,
                avatarUrl: person.avatar_url,
                variant: "analyst",
                label: person.username,
                href: link ? href(person) : undefined,
              }))}
              label="Co-geolocators"
              spacing="gap"
              size={size}
            />
          </>
        ) : (
          names.map((person, index) => (
            <Fragment key={person.username}>
              <CreditSeparator index={index} count={names.length} />
              {name(person)}
            </Fragment>
          ))
        )}
      </span>
    </span>
  );
}
