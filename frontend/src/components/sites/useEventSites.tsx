"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Link2, SquarePen } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { DetailCard, DetailRow } from "@/components/ui/DetailRow";
import { RemoveButton } from "@/components/ui/RemoveButton";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { TEXT_LINK } from "@/components/ui/styles";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import { apiFetch } from "@/lib/api";
import {
  SITE_KIND_LABELS,
  SITE_MARGIN_KM,
  eventSiteLinksPath,
  formatDistance,
  linkEventToSite,
  siteHref,
  siteSuggestionsPath,
  unlinkEventFromSite,
  type EventSiteLink,
  type SiteSuggestion,
} from "@/lib/sites";
import type { EventDetail } from "@/types";
import { CHANGE_EFFECT_COPY, LinkDialog, type LinkCandidate } from "./LinkDialog";
import { LinkEffectPill } from "./SiteBadges";
import { SatelliteSourcesOffer, fileOffered, useSatelliteOffer } from "./SatelliteSourcesOffer";

function suggestionCandidate(s: SiteSuggestion): LinkCandidate {
  const where =
    s.distance_m === null
      ? null
      : s.distance_m === 0
        ? "event inside the zone"
        : `${formatDistance(s.distance_m)} from the event`;
  return { id: s.id, label: s.name, meta: [SITE_KIND_LABELS[s.kind], where].filter(Boolean).join(" · ") };
}

/**
 * The sites of the event page, as two nodes over one read of the event's links:
 *
 * - `block`, the Sites block last in the side column: the sites the event is linked to now, each
 *   with the effect it shows there. The event's owner changes a link's effect and unlinks it on
 *   its row. Null while the event has no link.
 * - `linkAction`, **Link to a site** for the actions row: the owner of a published event links
 *   it to a site from the dialog it opens. Null for every other reader.
 *
 * `event` is null while the row loads and on a surface without sites: both nodes are null then.
 */
export function useEventSites(event: EventDetail | null): {
  block: ReactNode;
  linkAction: ReactNode;
} {
  const { user } = useAuth();
  const links = useApiResource<EventSiteLink[]>(event ? eventSiteLinksPath(event.id) : null);
  const [dialog, setDialog] = useState<{ edit?: EventSiteLink } | null>(null);
  const offer = useSatelliteOffer();
  const suggestions = useApiResource<SiteSuggestion[]>(
    event && dialog && !dialog.edit ? siteSuggestionsPath(event.id, "") : null,
  );
  const unlink = useMutation((siteId: string) => unlinkEventFromSite(event?.id ?? "", siteId), {
    fallback: "The unlink failed. Try again.",
    onSuccess: links.refetch,
  });

  if (!event) return { block: null, linkAction: null };

  const isOwner = user?.id === event.owner.id;
  // Mirrors backend `event_filters.site_linkable_events`: a published event only; change both.
  const canLink = isOwner && event.status === "geolocated";
  const rows = links.data ?? [];

  const block = (rows.length > 0 || links.error || unlink.error) && (
    <section>
      <SectionEyebrow title="Sites" concept="event_sites" />
      <DetailCard>
        {links.error && <div className={`m-3 ${FORM_ERROR_BANNER}`}>{links.error}</div>}
        {rows.map((row) => (
          <DetailRow
            key={row.site.id}
            align="center"
            wrapLabel
            label={
              <span className="text-neutral-400">
                Linked to{" "}
                <Link href={siteHref(row.site.id)} className={TEXT_LINK}>
                  {row.site.name}
                </Link>
              </span>
            }
          >
            <span className="ml-auto flex shrink-0 items-center justify-end gap-1">
              <LinkEffectPill effect={row.effect} />
              {canLink && (
                <Button
                  icon
                  variant="ghost"
                  aria-label={`Change the effect at ${row.site.name}`}
                  onClick={() => setDialog({ edit: row })}
                >
                  <SquarePen size={14} />
                </Button>
              )}
              {isOwner && (
                <RemoveButton
                  label={`Unlink from ${row.site.name}`}
                  disabled={unlink.loading}
                  onClick={() => void unlink.run(row.site.id)}
                />
              )}
            </span>
          </DetailRow>
        ))}
        {unlink.error && <div className={`m-3 ${FORM_ERROR_BANNER}`}>{unlink.error}</div>}
      </DetailCard>
    </section>
  );

  // The effect change opens from a row of the block, the link from the actions row: both are the
  // owner's, so the one dialog rides the action.
  const linkAction = canLink && (
    <>
      <Button
        icon
        variant="ghost"
        aria-label="Link to a site"
        aria-haspopup="dialog"
        onClick={() => setDialog({})}
      >
        <Link2 size={14} />
      </Button>
      {dialog && (
        <LinkDialog
          title={dialog.edit ? CHANGE_EFFECT_COPY.title : "Link to a site"}
          intro={
            dialog.edit
              ? CHANGE_EFFECT_COPY.intro
              : "Pick the site this event happened at, then say what the event shows there. The link holds even when the event lies outside the site's zone."
          }
          pickLabel="Site"
          suggestions={{
            label: `Sites within ${SITE_MARGIN_KM} km of the event`,
            rows: suggestions.data?.map(suggestionCandidate) ?? (suggestions.error ? [] : null),
            empty: `No site within ${SITE_MARGIN_KM} km. Search one by name.`,
          }}
          searchLabel="Search a site by name"
          searchPlaceholder="Search a site by name"
          search={(q, signal) =>
            apiFetch<SiteSuggestion[]>(siteSuggestionsPath(event.id, q), { signal }).then((found) =>
              found.map(suggestionCandidate),
            )
          }
          initial={
            dialog.edit && {
              candidate: {
                id: dialog.edit.site.id,
                label: dialog.edit.site.name,
                meta: SITE_KIND_LABELS[dialog.edit.site.kind],
              },
              effect: dialog.edit.effect,
            }
          }
          extra={
            dialog.edit
              ? undefined
              : () => (
                  <SatelliteSourcesOffer
                    sources={event.sources}
                    picked={offer.forEvent(event.id)}
                    onToggle={(id) => offer.toggle(event.id, id)}
                  />
                )
          }
          onLink={async (site, effect) => {
            await linkEventToSite(event.id, site.id, effect);
            links.refetch();
            await fileOffered(site.id, event.sources, offer.forEvent(event.id));
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );

  return { block, linkAction };
}
