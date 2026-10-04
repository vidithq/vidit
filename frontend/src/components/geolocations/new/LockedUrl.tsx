import type { ReactNode } from "react";

import { FieldAdornment, LOCKED_FIELD, TRAILING_ROOM } from "@/components/ui/Input";
import { TEXT_LINK } from "@/components/ui/styles";
import { cn } from "@/lib/cn";

/**
 * A locked URL field's value, rendered as the link it is. The value is inherited
 * (a request's source URL, an imported detection's provenance post) and
 * non-editable, but a reviewer needs to open it and an `<input readOnly>` holds
 * text, so it renders as an anchor in `LOCKED_FIELD`, the locked input's box.
 *
 * It shows the full URL and truncates rather than wraps, keeping the field one
 * line. Accent orange since it is clickable; the focus ring is the border the
 * default field turns on.
 *
 * `trailing` is `<Input>`'s adornment slot (the archive mark on a published
 * event's source URL): the field's actions are live though the value is frozen.
 * The link truncates before the adornment.
 */
export function LockedUrl({
  href,
  trailing,
}: {
  href: string;
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
