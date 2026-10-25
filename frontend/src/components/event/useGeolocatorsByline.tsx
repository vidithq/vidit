"use client";

import { useState, type ReactNode } from "react";
import { UserPlus } from "lucide-react";

import type { EventDetail } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { creditProps } from "@/lib/geolocatorCredit";
import { accountName, type Account } from "@/components/ui/AccountPicker";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Tooltip } from "@/components/ui/Tooltip";
import { DraftGeolocatorsCard, GeolocatorsCard } from "@/components/event/GeolocatorCredit";
import { PanelToggle, TogglePanel } from "@/components/event/useEventActions";

const PANEL_ID = "manage-geolocators-panel";
const LABEL = "Manage geolocators";

interface GeolocatorsByline {
  byline: ReactNode;
  panel: ReactNode;
}

/** The byline with **Manage geolocators** beside it, and the card the toggle opens. Two nodes,
 *  since `EventShell` places the card under the byline. */
function useBylineToggle(byline: ReactNode, card: ReactNode): GeolocatorsByline {
  const [open, setOpen] = useState(false);
  return {
    byline: (
      <span className="inline-flex flex-wrap items-center gap-2">
        {byline}
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
    panel: open && <TogglePanel id={PANEL_ID}>{card}</TogglePanel>,
  };
}

/** A published edit's title section: the byline the event page shows, and the geolocators panel
 *  (invite, withdraw, remove), whose changes apply on click. */
export function useGeolocatorsByline(event: EventDetail, onChanged: () => void): GeolocatorsByline {
  return useBylineToggle(
    <AuthorByline {...creditProps(event)} coAuthorsAs="avatars" avatar />,
    <GeolocatorsCard event={event} onChanged={onChanged} />,
  );
}

/** A form that publishes (the submit form, a request's or a detection's publish form): the
 *  reader's byline, and a card that picks the co-geolocators the publish invites. `invitees` are
 *  the picked usernames, which only the publish posts. */
export function useDraftGeolocatorsByline(): GeolocatorsByline & { invitees: string[] } {
  const { user } = useAuth();
  const [picked, setPicked] = useState<Account[]>([]);
  const toggle = useBylineToggle(
    user && <AuthorByline author={user} avatar />,
    user && <DraftGeolocatorsCard author={user} invitees={picked} onChange={setPicked} />,
  );
  return { ...toggle, invitees: picked.map(accountName) };
}
