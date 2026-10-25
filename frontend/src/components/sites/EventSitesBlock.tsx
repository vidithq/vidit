"use client";

import { useState } from "react";
import Link from "next/link";
import { Link2, SquarePen, X } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { DetailCard, DetailRow } from "@/components/ui/DetailRow";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { TEXT_LINK } from "@/components/ui/styles";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import {
  SITE_MARGIN_KM,
  SITE_TYPE_LABELS,
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
import { LinkEffectPill, SiteTypePill } from "./SiteBadges";

function suggestionCandidate(s: SiteSuggestion): LinkCandidate {
  const where =
    s.distance_m === null
      ? null
      : s.distance_m === 0
        ? "event inside the zone"
        : `event ${formatDistance(s.distance_m)} outside the zone`;
  return { id: s.id, label: s.name, meta: [SITE_TYPE_LABELS[s.site_type], where].filter(Boolean).join(" · ") };
}

/**
 * The event page's Sites block: the sites the event is linked to now, each with its effect. The
 * event's owner links it to a site, changes a link's effect, or unlinks it; only a published
 * (`geolocated`) event links.
 */
export function EventSitesBlock({ event }: { event: EventDetail }) {
  const { user } = useAuth();
  const links = useApiResource<EventSiteLink[]>(eventSiteLinksPath(event.id));
  const [dialog, setDialog] = useState<{ edit?: EventSiteLink } | null>(null);
  const isOwner = user?.id === event.owner.id;
  // Mirrors backend `event_filters.site_linkable_events`: a published event only; change both.
  const canLink = isOwner && event.status === "geolocated";
  const suggestions = useApiResource<SiteSuggestion[]>(
    dialog ? siteSuggestionsPath(event.id, "") : null,
  );
  const unlink = useMutation((siteId: string) => unlinkEventFromSite(event.id, siteId), {
    fallback: "Failed to unlink",
    onSuccess: links.refetch,
  });

  const rows = links.data ?? [];
  if (!canLink && rows.length === 0) return null;

  return (
    <div>
      <SectionEyebrow title="Sites" concept="link_effect" />
      <DetailCard>
        {links.error && <div className={`m-3 ${FORM_ERROR_BANNER}`}>{links.error}</div>}
        {rows.map((row) => (
          <DetailRow
            key={row.site.id}
            align="center"
            label={
              <span className="text-neutral-200">
                Linked to{" "}
                <Link href={siteHref(row.site.id)} className={TEXT_LINK}>
                  {row.site.name}
                </Link>
              </span>
            }
          >
            <span className="flex flex-wrap items-center justify-end gap-1.5">
              <SiteTypePill type={row.site.site_type} />
              <LinkEffectPill effect={row.effect} />
              {canLink && (
                <Button
                  icon
                  variant="ghost"
                  aria-label={`Change the effect on ${row.site.name}`}
                  onClick={() => setDialog({ edit: row })}
                >
                  <SquarePen size={14} />
                </Button>
              )}
              {isOwner && (
                <Button
                  icon
                  variant="dangerGhost"
                  aria-label={`Unlink from ${row.site.name}`}
                  disabled={unlink.loading}
                  onClick={() => void unlink.run(row.site.id)}
                >
                  <X size={14} />
                </Button>
              )}
            </span>
          </DetailRow>
        ))}
        {canLink && (
          <DetailRow
            align="center"
            label={rows.length === 0 ? "Not linked to a site." : "Only you, the owner, can link this event."}
          >
            <Button variant="secondary" onClick={() => setDialog({})}>
              <Link2 size={14} />
              Link to a site
            </Button>
          </DetailRow>
        )}
        {unlink.error && <div className={`m-3 ${FORM_ERROR_BANNER}`}>{unlink.error}</div>}
      </DetailCard>

      {dialog && (
        <LinkDialog
          title="Link to a site"
          subtitle={`${event.title}${event.occurred_date ? ` · ${formatDate(event.occurred_date)}` : ""}`}
          suggestedLabel={`Sites within ${SITE_MARGIN_KM} km of this event`}
          emptySuggestions={`No site within ${SITE_MARGIN_KM} km. Search one by name.`}
          suggestions={suggestions.data?.map(suggestionCandidate) ?? (suggestions.error ? [] : null)}
          searchPlaceholder="Site name"
          search={(q, signal) =>
            apiFetch<SiteSuggestion[]>(siteSuggestionsPath(event.id, q), { signal }).then((rows) =>
              rows.map(suggestionCandidate),
            )
          }
          initial={
            dialog.edit && {
              candidate: {
                id: dialog.edit.site.id,
                label: dialog.edit.site.name,
                meta: SITE_TYPE_LABELS[dialog.edit.site.site_type],
              },
              effect: dialog.edit.effect,
            }
          }
          onLink={async (siteId, effect) => {
            await linkEventToSite(event.id, siteId, effect);
            links.refetch();
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
