"use client";

import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import { Eye, EyeOff, ImagePlus, Link2, PenTool, SquarePen } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/AdminContext";
import { useMutation } from "@/hooks/useMutation";
import { setSiteModeration } from "@/lib/admin";
import { apiFetch } from "@/lib/api";
import { searchPickableEvents } from "@/lib/collections";
import { formatDate, formatInstant } from "@/lib/format";
import {
  SITE_KIND_LABELS,
  SITE_KINDS,
  SITE_NAME_MAX_LEN,
  linkEventToSite,
  ownsSite,
  siteContourHref,
  siteFileImageHref,
  siteHref,
  unlinkEventFromSite,
  updateSite,
  type Site,
  type SiteKind,
  type SiteLinkedEvent,
} from "@/lib/sites";
import type { EventDetail } from "@/types";
import { ShareControl } from "@/components/share/ShareControl";
import { useReportContent } from "@/components/report/useReportContent";
import { Button, buttonClasses } from "@/components/ui/Button";
import { CharCounter } from "@/components/ui/CharCounter";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { Input, Select } from "@/components/ui/Input";
import { RemoveButton } from "@/components/ui/RemoveButton";
import { Tooltip } from "@/components/ui/Tooltip";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { WARNING_CALLOUT } from "@/components/ui/styles";
import { cn } from "@/lib/cn";
import { CHANGE_EFFECT_COPY, LinkDialog, type LinkCandidate } from "./LinkDialog";
import { SatelliteImagesOffer, fileOffered, useSatelliteOffer } from "./SatelliteImagesOffer";
import { useApiResource } from "@/hooks/useApiResource";

function eventCandidate(event: { id: string; title: string; occurred_date: string | null }): LinkCandidate {
  return {
    id: event.id,
    label: event.title,
    meta: event.occurred_date ? formatDate(event.occurred_date) : "Undated",
  };
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
    <SatelliteImagesOffer
      sources={data.sources}
      picked={offer.forEvent(eventId)}
      onToggle={(id) => offer.toggle(eventId, id)}
    />
  );
}

function EditSiteDialog({
  site,
  onSaved,
  onClose,
}: {
  site: Site;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(site.name);
  const [kind, setKind] = useState<SiteKind>(site.kind);
  const trimmed = name.trim();
  const save = useMutation(
    () =>
      updateSite(site.id, {
        ...(trimmed !== site.name ? { name: trimmed } : {}),
        ...(kind !== site.kind ? { kind } : {}),
      }),
    {
      fallback: "The edit failed. Try again.",
      onSuccess: () => {
        onSaved();
        onClose();
      },
    },
  );
  const unchanged = trimmed === site.name && kind === site.kind;
  return (
    <ConfirmDialog
      title="Edit the site"
      confirmLabel="Save"
      busyLabel="Saving…"
      busy={save.loading}
      confirmDisabled={!trimmed || unchanged}
      error={save.error}
      onConfirm={() => void save.run()}
      onCancel={onClose}
    >
      <p>The site keeps its earlier name and kind on record.</p>
      <div className="space-y-1.5 pt-1">
        <FieldLabel
          label="Name"
          htmlFor="site-edit-name"
          invalid={!trimmed}
          trailing={<CharCounter length={name.length} max={SITE_NAME_MAX_LEN} />}
        />
        <Input
          id="site-edit-name"
          value={name}
          maxLength={SITE_NAME_MAX_LEN}
          invalid={!trimmed}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-1.5 pt-1">
        <FieldLabel label="Kind" concept="site_kind" htmlFor="site-edit-kind" />
        <Select id="site-edit-kind" value={kind} onChange={(e) => setKind(e.target.value as SiteKind)}>
          {SITE_KINDS.map((value) => (
            <option key={value} value={value}>
              {SITE_KIND_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>
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

type Dialog =
  | { kind: "edit" }
  | { kind: "moderate" }
  | { kind: "link" }
  | { kind: "effect"; event: SiteLinkedEvent };

/**
 * The controls of one site, assembled once like `useEventActions` and in its order: one icon
 * row (Edit and Redraw the contour for the owner, Share for every reader, File an image and Link
 * one of my events for any signed-in analyst, Withhold or Restore for an admin, Report last for
 * every reader but the owner); and the panels they open. `linkControls` gives a linked event's
 * author the effect change and the unlink on its row.
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
  linkControls: (event: SiteLinkedEvent) => ReactNode;
} {
  const { user } = useAuth();
  const { isAdmin } = useAdmin();
  const report = useReportContent("site", site?.id ?? "");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const offer = useSatelliteOffer();
  const unlink = useMutation((eventId: string) => unlinkEventFromSite(eventId, site!.id), {
    fallback: "The unlink failed. Try again.",
    onSuccess: onChanged,
  });

  if (!site) return { pinned: null, panels: null, linkControls: () => null };

  const owner = ownsSite(site, user?.id);
  const withheld = site.hidden_at !== null;
  const linked = new Set(site.linked_events.map((e) => e.id));

  const linkControls = (event: SiteLinkedEvent) =>
    user?.id === event.owner.id && (
      <>
        <Button
          icon
          variant="ghost"
          aria-label={`Change the effect of ${event.title}`}
          onClick={() => setDialog({ kind: "effect", event })}
        >
          <SquarePen size={14} />
        </Button>
        <RemoveButton
          label={`Unlink ${event.title}`}
          disabled={unlink.loading}
          onClick={() => void unlink.run(event.id)}
        />
      </>
    );

  const icons = [
    owner && (
      <Button key="edit" icon variant="ghost" aria-label="Edit the name and kind" onClick={() => setDialog({ kind: "edit" })}>
        <SquarePen size={14} />
      </Button>
    ),
    owner && (
      <Tooltip key="contour" label="Redraw the contour">
        <Link
          href={siteContourHref(site.id)}
          className={buttonClasses("ghost", { icon: true })}
          aria-label="Redraw the contour"
        >
          <PenTool size={14} />
        </Link>
      </Tooltip>
    ),
    <ShareControl key="share" path={siteHref(site.id)} title={site.name} />,
    user && !withheld && (
      <Tooltip key="file" label="File an image">
        <Link
          href={siteFileImageHref(site.id)}
          className={buttonClasses("ghost", { icon: true })}
          aria-label="File an image"
        >
          <ImagePlus size={14} />
        </Link>
      </Tooltip>
    ),
    user && !withheld && (
      <Button key="link" icon variant="ghost" aria-label="Link one of my events" onClick={() => setDialog({ kind: "link" })}>
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
      {unlink.error && <p className={FORM_ERROR_BANNER}>{unlink.error}</p>}
      {dialog?.kind === "edit" && (
        <EditSiteDialog site={site} onSaved={onChanged} onClose={() => setDialog(null)} />
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
          search={async (q) => {
            const { items } = await searchPickableEvents(user.username, q);
            return items
              .filter((e) => e.status === "geolocated" && !linked.has(e.id))
              .map(eventCandidate);
          }}
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
      {dialog?.kind === "effect" && (
        <LinkDialog
          {...CHANGE_EFFECT_COPY}
          pickLabel="Event"
          searchLabel="Search your events by title"
          searchPlaceholder="Search your events by title"
          search={async () => []}
          initial={{ candidate: eventCandidate(dialog.event), effect: dialog.event.effect }}
          onLink={(event, effect) => linkEventToSite(event.id, site.id, effect).then(onChanged)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );

  return { pinned, panels, linkControls };
}
