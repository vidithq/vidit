"use client";

import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import { Eye, EyeOff, ImagePlus, Link2, SquarePen } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/AdminContext";
import { useMutation } from "@/hooks/useMutation";
import { setSiteModeration } from "@/lib/admin";
import { apiFetch } from "@/lib/api";
import { formatInstant } from "@/lib/format";
import {
  contourOfSource,
  linkEventToSite,
  ownsSite,
  removeSiteSource,
  siteEditHref,
  siteFileSourceHref,
  siteHref,
  siteVersioned,
  type Site,
  type SiteSource,
} from "@/lib/sites";
import { searchPickableEvents } from "@/lib/collections";
import { formatDate } from "@/lib/format";
import type { EventDetail } from "@/types";
import { VersionSelector } from "@/components/event/VersionSelector";
import { ShareControl } from "@/components/share/ShareControl";
import { useReportContent } from "@/components/report/useReportContent";
import { Button, buttonClasses } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { RemoveButton } from "@/components/ui/RemoveButton";
import { Tooltip } from "@/components/ui/Tooltip";
import { WARNING_CALLOUT } from "@/components/ui/styles";
import { cn } from "@/lib/cn";
import { LinkDialog } from "./LinkDialog";
import { SatelliteSourcesOffer, fileOffered, useSatelliteOffer } from "./SatelliteSourcesOffer";
import { removeSourceLabel, siteSourceMention } from "./SiteSourceBlock";
import { useApiResource } from "@/hooks/useApiResource";

/** The analyst's published events whose title matches, less those already linked. */
async function searchOwnEvents(username: string, q: string, exclude: ReadonlySet<string>) {
  const { items } = await searchPickableEvents(username, q);
  return items
    .filter((e) => e.status === "geolocated" && !exclude.has(e.id))
    .map((e) => ({
      id: e.id,
      label: e.title,
      meta: e.occurred_date ? formatDate(e.occurred_date) : "Undated",
    }));
}

/** The picked event's satellite sources, read once it is picked. */
function PickedEventOffer({
  eventId,
  offer,
}: {
  eventId: string;
  offer: ReturnType<typeof useSatelliteOffer>;
}) {
  const { data } = useApiResource<EventDetail>(`/events/${encodeURIComponent(eventId)}`);
  if (!data) return null;
  return (
    <SatelliteSourcesOffer
      sources={data.sources}
      picked={offer.forEvent(eventId)}
      onToggle={(id) => offer.toggle(eventId, id)}
    />
  );
}

function RemoveSourceDialog({
  site,
  source,
  onDone,
  onClose,
}: {
  site: Site;
  source: SiteSource;
  onDone: () => void;
  onClose: () => void;
}) {
  const remove = useMutation(() => removeSiteSource(site.id, source.id), {
    fallback: "The source was not removed. Try again.",
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  return (
    <ConfirmDialog
      title={`Remove ${siteSourceMention(source)}?`}
      confirmLabel="Remove"
      busyLabel="Removing…"
      busy={remove.loading}
      error={remove.error}
      onConfirm={() => void remove.run()}
      onCancel={onClose}
    >
      <p>
        The source leaves the site and the site saves a new version. Its earlier versions keep the
        source.
      </p>
    </ConfirmDialog>
  );
}

function ModerationDialog({
  site,
  onDone,
  onClose,
}: {
  site: Site;
  onDone: () => void;
  onClose: () => void;
}) {
  const withheld = site.hidden_at !== null;
  const write = useMutation(() => setSiteModeration(site.id, !withheld), {
    fallback: "The moderation failed. Try again.",
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  return (
    <ConfirmDialog
      title={withheld ? "Restore this site?" : "Withhold this site?"}
      confirmLabel={withheld ? "Restore" : "Withhold"}
      busyLabel={withheld ? "Restoring…" : "Withholding…"}
      busy={write.loading}
      error={write.error}
      onConfirm={() => void write.run()}
      onCancel={onClose}
    >
      <p>
        {withheld
          ? "The site returns to the map, to the event pages and to its owner."
          : "The site leaves every public read, the map and the event pages included, until an admin restores it. Admins still read it here. The events linked to it are untouched."}
      </p>
    </ConfirmDialog>
  );
}

type Dialog = { kind: "remove"; source: SiteSource } | { kind: "moderate" } | { kind: "link" };

/**
 * The controls of one site, assembled once like `useEventActions` and in its order: one icon
 * row (the version selector for every reader, Edit for the owner, Share for every reader, File a
 * source and Link one of my events for any signed-in analyst, Withhold or Restore for an admin,
 * Report last for every reader but the owner); and the panels they open. `sourceControls` gives
 * a source's filer its Remove, off while the source carries a contour.
 */
export function useSiteActions({
  site,
  onChanged,
}: {
  site: Site | null;
  onChanged: () => void;
}): {
  pinned: ReactNode;
  panels: ReactNode;
  sourceControls: (source: SiteSource) => ReactNode;
} {
  const { user } = useAuth();
  const { isAdmin } = useAdmin();
  const report = useReportContent("site", site?.id ?? "");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const offer = useSatelliteOffer();

  if (!site) return { pinned: null, panels: null, sourceControls: () => null };

  const owner = ownsSite(site, user?.id);
  const withheld = site.hidden_at !== null;
  const linked = new Set(site.linked_events.map((e) => e.id));

  const sourceControls = (source: SiteSource) =>
    user?.id === source.author?.id && (
      <RemoveButton
        label={removeSourceLabel(source, contourOfSource(site.contours, source.id) !== null)}
        confirms
        disabled={contourOfSource(site.contours, source.id) !== null}
        onClick={() => setDialog({ kind: "remove", source })}
      />
    );

  const icons = [
    <VersionSelector key="versions" record={siteVersioned(site)} selected={site.version_no} />,
    owner && (
      <Tooltip key="edit" label="Edit (saves a new version)">
        <Link
          href={siteEditHref(site.id)}
          className={buttonClasses("ghost", { icon: true })}
          aria-label="Edit"
        >
          <SquarePen size={14} />
        </Link>
      </Tooltip>
    ),
    <ShareControl key="share" path={siteHref(site.id)} title={site.name} />,
    user && !withheld && (
      <Tooltip key="file" label="File a source">
        <Link
          href={siteFileSourceHref(site.id)}
          className={buttonClasses("ghost", { icon: true })}
          aria-label="File a source"
        >
          <ImagePlus size={14} />
        </Link>
      </Tooltip>
    ),
    user && !withheld && (
      <Button
        key="link"
        icon
        variant="ghost"
        aria-label="Link one of my events"
        aria-haspopup="dialog"
        onClick={() => setDialog({ kind: "link" })}
      >
        <Link2 size={14} />
      </Button>
    ),
    isAdmin && (
      <Button
        key="moderate"
        icon
        variant={withheld ? "ghost" : "dangerGhost"}
        aria-label={withheld ? "Restore the site" : "Withhold the site"}
        onClick={() => setDialog({ kind: "moderate" })}
      >
        {withheld ? <Eye size={14} /> : <EyeOff size={14} />}
      </Button>
    ),
    !owner && <Fragment key="report">{report.trigger}</Fragment>,
  ].filter(Boolean);

  const pinned = (
    <div role="group" aria-label="Site actions" className="flex flex-wrap items-center justify-end gap-1.5">
      {icons}
    </div>
  );

  const panels = (
    <>
      {withheld && (
        <p role="status" className={cn("rounded-lg px-4 py-3 text-sm", WARNING_CALLOUT)}>
          Withheld since {formatInstant(site.hidden_at)}. Only admins read this site until it is restored.
        </p>
      )}
      {!owner && report.panel}
      {dialog?.kind === "remove" && (
        <RemoveSourceDialog
          site={site}
          source={dialog.source}
          onDone={onChanged}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "moderate" && (
        <ModerationDialog site={site} onDone={onChanged} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "link" && user && (
        <LinkDialog
          title="Link one of my events"
          intro="Pick one of your published events, then say what it shows at this site. The link holds even when the event lies outside the zone."
          pickLabel="Event"
          searchLabel="Search your events by title"
          searchPlaceholder="Search your events by title"
          search={(q) => searchOwnEvents(user.username, q, linked)}
          extra={(picked) => <PickedEventOffer eventId={picked.id} offer={offer} />}
          onLink={async (event, effect) => {
            await linkEventToSite(event.id, site.id, effect);
            onChanged();
            const picks = offer.forEvent(event.id);
            if (picks.size > 0) {
              const detail = await apiFetch<EventDetail>(`/events/${encodeURIComponent(event.id)}`);
              await fileOffered(site.id, detail.sources, picks);
              onChanged();
            }
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );

  return { pinned, panels, sourceControls };
}
