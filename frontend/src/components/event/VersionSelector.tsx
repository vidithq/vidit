"use client";

import { ChevronDown, History } from "lucide-react";

import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import type { VersionedRecord } from "@/lib/versions";

/**
 * The version a record's page shows (an event, a site), as a compact *v2* button in the header,
 * opening a list as wide as the button: the record's versions newest first (*v2*, *v1*, then an
 * event's *Detection* or *Request* for a version 0), the one on screen marked, then **History**.
 * The live version opens the record's own page, an older one its `/vN` address. It shows on a
 * single-version record too, so the version on screen is always named.
 */
export function VersionSelector({
  record,
  selected,
}: {
  record: VersionedRecord;
  /** The version on screen. */
  selected: number;
}) {
  const versions: ActionMenuItem[] = Array.from(
    { length: record.latest - record.first + 1 },
    (_, i) => {
      const n = record.latest - i;
      return { key: `v${n}`, label: record.label(n), href: record.href(n), current: n === selected };
    }
  );
  const name = record.label(selected);
  // A list of vN entries fits the button. A version 0 entry names the request or the detection,
  // which a vN button cannot hold, so that list takes the menu's own width.
  const compact = record.first === 1;
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
          href: record.historyHref,
          iconOnly: compact,
        },
      ]}
    />
  );
}
