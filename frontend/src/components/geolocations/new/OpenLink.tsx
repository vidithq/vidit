import { ExternalLink } from "lucide-react";

import { TEXT_LINK } from "@/components/ui/styles";

/**
 * The "open this" affordance under a locked URL field, the companion to
 * [`LockedHint`](./LockedHint.tsx).
 *
 * A locked field is still a real `<input>`, so its value cannot itself be a
 * link: reaching the post meant selecting the URL and copying it by hand. The
 * shape is the one `CoordinateActions` already puts under a coordinate pair,
 * a text link plus the external-link glyph, so a read-only value carries the
 * same outbound affordance wherever it appears.
 *
 * An anchor, not a button, because this is navigation: it brings the whole set
 * of link gestures with it (middle-click, open in a new window, copy link
 * address), which is what an analyst reviewing a draft reaches for. `label` is
 * the visible text and therefore the accessible name, so it says what opens
 * instead of reading as a bare "link".
 */
export function OpenLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${TEXT_LINK} inline-flex items-center gap-1 text-xs outline-hidden focus-visible:ring-1 focus-visible:ring-orange-400 rounded-xs`}
    >
      {label}
      <ExternalLink size={11} />
    </a>
  );
}
