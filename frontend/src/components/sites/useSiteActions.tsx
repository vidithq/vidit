"use client";

import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import { Eye, ImagePlus, Link2, SquarePen } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/AdminContext";
import { useMutation } from "@/hooks/useMutation";
import { setSiteModeration } from "@/lib/admin";
import { apiFetch } from "@/lib/api";
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
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Tooltip } from "@/components/ui/Tooltip";
import { WithheldBanner } from "@/components/ui/WithheldBanner";
import { LinkDialog } from "./LinkDialog";
import { SatelliteSourcesOffer, fileOffered, useSatelliteOffer } from "./SatelliteSourcesOffer";
import { removeSourceLabel } from "./SiteSourceBlock";
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

/**
 * The controls of one site, assembled once like `useEventActions` and in its order: one icon
 * row (the version selector for every reader, Edit for the owner, Share for every reader, File a
 * source and Link one of my events for any signed-in analyst, Withhold or Restore for an admin,
 * Report last for every reader but the owner); and the panels they open. `sourceControls` gives
 * a source's filer its Remove, off while the source carries a contour. Withhold and Remove
 * confirm in place; Restore acts at once. A refusal of either shows in the panels.
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
  const [linking, setLinking] = useState(false);
  const offer = useSatelliteOffer();
  const removeSource = useMutation(
    (siteId: string, sourceId: string) => removeSiteSource(siteId, sourceId),
    { fallback: "The source was not removed. Try again.", onSuccess: onChanged },
  );
  const moderate = useMutation((siteId: string, hide: boolean) => setSiteModeration(siteId, hide), {
    fallback: "The moderation failed. Try again.",
    onSuccess: onChanged,
  });

  if (!site) return { pinned: null, panels: null, sourceControls: () => null };

  const owner = ownsSite(site, user?.id);
  const withheld = site.hidden_at !== null;
  const linked = new Set(site.linked_events.map((e) => e.id));
  const error = removeSource.error ?? moderate.error;

  const sourceControls = (source: SiteSource) =>
    user?.id === source.author?.id && (
      <ConfirmButton
        icon
        label={removeSourceLabel(source, contourOfSource(site.contours, source.id) !== null)}
        disabled={contourOfSource(site.contours, source.id) !== null || removeSource.loading}
        onConfirm={() => removeSource.run(site.id, source.id)}
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
        onClick={() => setLinking(true)}
      >
        <Link2 size={14} />
      </Button>
    ),
    isAdmin &&
      (withheld ? (
        <Button
          key="moderate"
          icon
          variant="ghost"
          aria-label="Restore the site"
          disabled={moderate.loading}
          onClick={() => void moderate.run(site.id, false)}
        >
          <Eye size={14} />
        </Button>
      ) : (
        <ConfirmButton
          key="moderate"
          icon
          action="hide"
          label="Withhold the site"
          disabled={moderate.loading}
          onConfirm={() => moderate.run(site.id, true)}
        />
      )),
    !owner && <Fragment key="report">{report.trigger}</Fragment>,
  ].filter(Boolean);

  const pinned = (
    <div role="group" aria-label="Site actions" className="flex flex-wrap items-center justify-end gap-1.5">
      {icons}
    </div>
  );

  const panels = (
    <>
      {site.hidden_at && <WithheldBanner since={site.hidden_at} noun="site" />}
      {!owner && report.panel}
      {error && <ErrorNotice error={error} />}
      {linking && user && (
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
          onClose={() => setLinking(false)}
        />
      )}
    </>
  );

  return { pinned, panels, sourceControls };
}
