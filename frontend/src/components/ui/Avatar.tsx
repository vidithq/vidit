"use client";

import { useState } from "react";
import { User } from "lucide-react";

// User avatar circle: the image, or a fallback (a neutral icon or the username
// initial). A `<div>` by default; pass `as="span"` inside phrasing content
// (`AuthorByline`), where a block child is invalid nesting.
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
  /** Sizing utility, e.g. `size-10`. The icon fallback scales off it. */
  size: string;
  fallback?: "initial" | "icon";
  as?: "div" | "span";
  /** Drop the alt text for a host that names itself (the sidebar identity
   *  row): alt text would win over the link's title as its accessible name. */
  decorative?: boolean;
  /** Colour for the icon fallback (`text-current` to follow the host). */
  iconClassName?: string;
}) {
  // An `avatar_url` can 404 (the object is deleted on replace, and a CDN edge
  // can lag a new one). Track the failed src, not a flag, so a new picture
  // retries.
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
          // An error before hydration never reaches `onError`; an image that
          // completed with nothing decoded failed.
          ref={(node) => {
            if (node?.complete && node.naturalWidth === 0) setFailedSrc(src);
          }}
          className="w-full h-full object-cover"
        />
      ) : fallback === "icon" ? (
        // Sized in CSS so the glyph tracks the circle, not lucide's `size` prop.
        <User className={`w-1/2 h-1/2 ${iconClassName}`} />
      ) : (
        <span className="text-neutral-300 font-medium">
          {username[0]?.toUpperCase() ?? "?"}
        </span>
      )}
    </Tag>
  );
}
