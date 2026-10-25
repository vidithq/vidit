"use client";

import { ChevronDown, History } from "lucide-react";

import { eventHistoryHref, eventVersionHref, firstVersion, versionLabel } from "@/lib/events";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { eventHref } from "@/lib/routes";
import type { EventDetail } from "@/types";

/**
 * The version a published event's page shows, as a compact *v2* button in the header, opening a
 * list as wide as the button: the event's versions newest first (*v2*, *v1*, then *Detection* or
 * *Request* for a version 0), the one on screen marked, then **History**. The live version opens
 * the canonical `/events/{id}`, an older one `/events/{id}/vN`. It shows on a single-version
 * event too, so the version on screen is always named.
 */
export function VersionSelector({
  event,
  selected,
}: {
  event: Pick<EventDetail, "id" | "version_no" | "version_zero">;
  /** The version on screen. */
  selected: number;
}) {
  const first = firstVersion(event);
  const versions: ActionMenuItem[] = Array.from(
    { length: event.version_no - first + 1 },
    (_, i) => {
      const n = event.version_no - i;
      return {
        key: `v${n}`,
        label: versionLabel(event, n),
        href: n === event.version_no ? eventHref(event.id) : eventVersionHref(event.id, n),
        current: n === selected,
      };
    }
  );
  const name = versionLabel(event, selected);
  // A list of vN entries fits the button. A version 0 entry names the request or the detection,
  // which a vN button cannot hold, so that list takes the menu's own width.
  const compact = first === 1;
  return (
    <ActionMenu
      label={`${name}: choose a version`}
      text={name}
      icon={<ChevronDown size={14} />}
      menuLabel="Versions"
      matchTriggerWidth={compact}
      items={[
        ...versions,
        // A vN button is narrower than the icon and the word: the entry shows its icon alone.
        {
          key: "history",
          label: "History",
          icon: <History size={14} />,
          href: eventHistoryHref(event.id),
          iconOnly: compact,
        },
      ]}
    />
  );
}
