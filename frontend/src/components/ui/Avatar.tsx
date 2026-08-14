"use client";

import { useState } from "react";
import { User } from "lucide-react";

// User avatar circle: the avatar image, or a fallback (a neutral user icon, or
// the username initial). Every surface that shows a profile picture composes
// this, the geolocation feed card's author circle included.
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
  decorative = false,
  iconClassName = "text-neutral-500",
}: {
  src?: string | null;
  username: string;
  /** Sizing utility, e.g. `w-11 h-11` or `size-10`. The icon fallback scales
   *  off it, so the circle is the only dimension a caller sets. */
  size: string;
  fallback?: "initial" | "icon";
  as?: "div" | "span";
  /** Drop the image's alt text, for a host that already names itself (the
   *  sidebar identity row, whose link is titled with the handle). An `<img>`
   *  carrying alt text becomes the link's accessible name and wins over that
   *  title, so the row would announce "user's avatar" instead of the handle. */
  decorative?: boolean;
  /** Colour utility for the icon fallback, so a host whose row paints its own
   *  `currentColor` (hover, active) can hand it down with `text-current`.
   *  Sizing stays with `size`. */
  iconClassName?: string;
}) {
  // An `avatar_url` is a URL its owner types, so it can 404, or be `http://`
  // on an HTTPS deploy where the browser blocks it. Track the src that failed
  // rather than a flag, so typing a new URL in the profile form retries.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = !!src && src !== failedSrc;

  return (
    <Tag
      className={`${size} rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center overflow-hidden shrink-0`}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={decorative ? "" : `${username}'s avatar`}
          onError={() => setFailedSrc(src)}
          className="w-full h-full object-cover"
        />
      ) : fallback === "icon" ? (
        // Sized in CSS, not by lucide's `size` prop: the class wins over the
        // svg's width/height attributes, so the glyph tracks whatever circle
        // the caller asked for instead of being pinned to one avatar size.
        <User className={`w-1/2 h-1/2 ${iconClassName}`} />
      ) : (
        <span className="text-neutral-300 font-medium">
          {username[0]?.toUpperCase() ?? "?"}
        </span>
      )}
    </Tag>
  );
}
