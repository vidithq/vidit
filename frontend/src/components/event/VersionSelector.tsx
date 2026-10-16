"use client";

import { ChevronDown, History } from "lucide-react";

import { eventHistoryHref, eventVersionHref } from "@/lib/events";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";

/**
 * The version a published event's page shows, as a compact *v2* button in the header, opening the
 * event's versions newest first and **Full history**. The live version opens the canonical
 * `/events/{id}`, an older one `/events/{id}/vN`. It shows on a single-version event too, so the
 * version on screen is always named.
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
      label: `Version ${n}`,
      meta: n === liveVersion ? "Current" : undefined,
      href: n === liveVersion ? `/events/${eventId}` : eventVersionHref(eventId, n),
      current: n === selected,
    };
  });
  return (
    <ActionMenu
      label={`v${selected}: choose a version`}
      text={`v${selected}`}
      icon={<ChevronDown size={14} />}
      menuLabel="Versions"
      items={[
        ...versions,
        {
          key: "history",
          label: "Full history",
          icon: <History size={14} />,
          href: eventHistoryHref(eventId),
        },
      ]}
    />
  );
}
