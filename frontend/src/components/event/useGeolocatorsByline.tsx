"use client";

import { useState, type ReactNode } from "react";
import { UserPlus } from "lucide-react";

import type { EventDetail } from "@/types";
import { creditProps } from "@/lib/geolocatorCredit";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Tooltip } from "@/components/ui/Tooltip";
import { GeolocatorsCard } from "@/components/event/GeolocatorCredit";
import { PanelToggle, TogglePanel } from "@/components/event/useEventActions";

const PANEL_ID = "manage-geolocators-panel";
const LABEL = "Manage geolocators";

/**
 * A published edit's title section: the byline the event page shows, with a toggle beside it that
 * opens the geolocators panel under it (invite, withdraw, remove). Returns the byline and the panel
 * as two nodes, since `EventShell` places the panel under the byline and over the Title field.
 */
export function useGeolocatorsByline(
  event: EventDetail,
  onChanged: () => void,
): { byline: ReactNode; panel: ReactNode } {
  const [open, setOpen] = useState(false);
  return {
    byline: (
      <span className="inline-flex flex-wrap items-center gap-2">
        <AuthorByline {...creditProps(event)} coAuthorsAs="avatars" avatar />
        <Tooltip label={LABEL}>
          <PanelToggle
            open={open}
            onToggle={() => setOpen(!open)}
            label={LABEL}
            panelId={PANEL_ID}
            icon={<UserPlus size={14} />}
          />
        </Tooltip>
      </span>
    ),
    panel: open && (
      <TogglePanel id={PANEL_ID}>
        <GeolocatorsCard event={event} onChanged={onChanged} />
      </TogglePanel>
    ),
  };
}
