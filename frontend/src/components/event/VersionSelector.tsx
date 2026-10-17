"use client";

import { ChevronDown, History } from "lucide-react";

import { eventHistoryHref, eventVersionHref } from "@/lib/events";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { eventHref } from "@/lib/routes";

/**
 * The version a published event's page shows, as a compact *v2* button in the header, opening a
 * list as wide as the button: the event's versions newest first (*v2*, *v1*), the one on screen
 * marked, then **History**. The live version opens the canonical `/events/{id}`, an older one
 * `/events/{id}/vN`. It shows on a single-version event too, so the version on screen is always
 * named.
 */
export function VersionSelector({
  eventId,
  liveVersion,
  selected,
}: {
  eventId: string;
  liveVersion: number;
  /** The version on screen. */
  selected: number;
}) {
  const versions: ActionMenuItem[] = Array.from({ length: liveVersion }, (_, i) => {
    const n = liveVersion - i;
    return {
      key: `v${n}`,
      label: `v${n}`,
      href: n === liveVersion ? eventHref(eventId) : eventVersionHref(eventId, n),
      current: n === selected,
    };
  });
  return (
    <ActionMenu
      label={`v${selected}: choose a version`}
      text={`v${selected}`}
      icon={<ChevronDown size={14} />}
      menuLabel="Versions"
      matchTriggerWidth
      items={[
        ...versions,
        // A vN button is narrower than the icon and the word: the entry shows its icon alone.
        {
          key: "history",
          label: "History",
          icon: <History size={14} />,
          href: eventHistoryHref(eventId),
          iconOnly: true,
        },
      ]}
    />
  );
}
