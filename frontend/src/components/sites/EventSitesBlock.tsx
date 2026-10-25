"use client";

import { useState } from "react";
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
import { LinkDialog, type LinkCandidate } from "./LinkDialog";
import { LinkEffectPill } from "./SiteBadges";
import { SatelliteImagesOffer, fileOffered, useSatelliteOffer } from "./SatelliteImagesOffer";

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
 * The event page's Sites block, last in the side column: the sites the event is linked to now,
 * each with the effect it shows there. The event's owner links it to a site, changes a link's
 * effect, and unlinks it. A reader sees the block only when a link exists.
 */
export function EventSitesBlock({ event }: { event: EventDetail }) {
  const { user } = useAuth();
  const links = useApiResource<EventSiteLink[]>(eventSiteLinksPath(event.id));
  const [dialog, setDialog] = useState<{ edit?: EventSiteLink } | null>(null);
  const offer = useSatelliteOffer();
  const isOwner = user?.id === event.owner.id;
  // Mirrors backend `event_filters.site_linkable_events`: a published event only; change both.
  const canLink = isOwner && event.status === "geolocated";
  const suggestions = useApiResource<SiteSuggestion[]>(
    dialog && !dialog.edit ? siteSuggestionsPath(event.id, "") : null,
  );
  const unlink = useMutation((siteId: string) => unlinkEventFromSite(event.id, siteId), {
    fallback: "The unlink failed. Try again.",
    onSuccess: links.refetch,
  });

  const rows = links.data ?? [];
  if (!canLink && rows.length === 0) return null;

  return (
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
        {canLink && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
            <p className="text-sm text-neutral-500">
              {rows.length === 0 ? "Not linked to a site yet." : "Link it to another site."}
            </p>
            <Button variant="secondary" onClick={() => setDialog({})}>
              <Link2 size={14} />
              Link to a site
            </Button>
          </div>
        )}
        {unlink.error && <div className={`m-3 ${FORM_ERROR_BANNER}`}>{unlink.error}</div>}
      </DetailCard>

      {dialog && (
        <LinkDialog
          title={dialog.edit ? "Change the effect" : "Link to a site"}
          intro={
            dialog.edit
              ? "The link keeps its history: the site's page records the effect it had and the new one."
              : "Pick the site this event happened at, then say what the event shows there. The link holds even when the event lies outside the site's zone."
          }
          pickLabel="Site"
          suggestedLabel={`Sites within ${SITE_MARGIN_KM} km of the event`}
          suggestions={suggestions.data?.map(suggestionCandidate) ?? (suggestions.error ? [] : null)}
          emptySuggestions={`No site within ${SITE_MARGIN_KM} km. Search one by name.`}
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
                  <SatelliteImagesOffer
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
    </section>
  );
}
