import { User } from "lucide-react";

// User avatar circle: the avatar image, or a fallback (a neutral user icon, or
// the username initial). Shared by the profile header and the search user
// results, which hand-rolled the same circle. The clickable initial-avatar on
// the geolocation feed card is a different (link + hover) treatment, left as-is.
//
// A `<div>` by default. Pass `as="span"` inside phrasing content (the
// `AuthorByline`, itself a `<span>` that sits in paragraphs and headings),
// where a block-level child is invalid nesting.
export function Avatar({
  src,
  username,
  size,
  fallback = "initial",
  as: Tag = "div",
}: {
  src?: string | null;
  username: string;
  /** Sizing utility, e.g. `w-11 h-11` or `size-10`. The icon fallback scales
   *  off it, so the circle is the only dimension a caller sets. */
  size: string;
  fallback?: "initial" | "icon";
  as?: "div" | "span";
}) {
  return (
    <Tag
      className={`${size} rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center overflow-hidden shrink-0`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`${username}'s avatar`}
          className="w-full h-full object-cover"
        />
      ) : fallback === "icon" ? (
        // Sized in CSS, not by lucide's `size` prop: the class wins over the
        // svg's width/height attributes, so the glyph tracks whatever circle
        // the caller asked for instead of being pinned to one avatar size.
        <User className="w-1/2 h-1/2 text-neutral-500" />
      ) : (
        <span className="text-neutral-300 font-medium">
          {username[0]?.toUpperCase() ?? "?"}
        </span>
      )}
    </Tag>
  );
}
