import type { ReactNode } from "react";

import { FieldAdornment, LOCKED_FIELD, TRAILING_ROOM } from "@/components/ui/Input";
import { TEXT_LINK } from "@/components/ui/styles";
import { cn } from "@/lib/cn";

/**
 * A locked URL field's value, rendered as the link it already is.
 *
 * The value is inherited (a request's source URL, an imported detection's
 * provenance post) and stays non-editable, but it is still a URL a reviewer
 * needs to open, and an `<input readOnly>` holds text rather than markup. So
 * the field renders as an anchor instead, wearing `LOCKED_FIELD`, the same box
 * recipe the locked input wears, so it reads as the field it is rather than as
 * a link that wandered into the form.
 *
 * The anchor carries the full URL, which is what the field displayed before:
 * reducing it to a host (as `SourceLabel` does on the detail surfaces, where
 * space is the constraint) would say strictly less than the field it replaces.
 * It truncates rather than wraps, so a long permalink keeps the field one line
 * high. Accent orange per the accent recipe, since it is clickable, and the
 * focus ring is the border the default field turns on focus, so a focused
 * locked link looks like a focused field.
 *
 * `trailing` is the adornment slot `<Input>` carries, in the same place and at
 * the same size: the value is frozen, but the field's own actions are not, and
 * the archive mark on a published event's source URL sits here. The link
 * truncates before the adornment rather than under it.
 */
export function LockedUrl({
  href,
  trailing,
}: {
  href: string;
  /** Marks overlaid at the field's right edge, as on `<Input trailing>`. */
  trailing?: ReactNode;
}) {
  const link = (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        LOCKED_FIELD,
        TEXT_LINK,
        "block truncate outline-hidden focus-visible:border-orange-500",
        trailing && TRAILING_ROOM,
      )}
    >
      {href}
    </a>
  );

  if (!trailing) return link;
  return (
    <div className="relative">
      {link}
      <FieldAdornment>{trailing}</FieldAdornment>
    </div>
  );
}
