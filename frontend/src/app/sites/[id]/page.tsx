"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Link2, MapPin, Plus } from "lucide-react";

import { AuthorByline } from "@/components/ui/AuthorByline";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DetailCard, DetailRow } from "@/components/ui/DetailRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkRow } from "@/components/ui/LinkRow";
import { OutboundLink } from "@/components/ui/OutboundLink";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { META_LINE, TEXT_LINK } from "@/components/ui/styles";
import { AddObservationPanel } from "@/components/sites/AddObservationPanel";
import { LinkDialog, type LinkCandidate } from "@/components/sites/LinkDialog";
import {
  CorroborationPill,
  LinkEffectPill,
  ObservationEffectPill,
  SiteTypePill,
} from "@/components/sites/SiteBadges";
import { SiteHistory } from "@/components/sites/SiteHistory";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { searchPickableEvents } from "@/lib/collections";
import { formatDate } from "@/lib/format";
import { eventHref } from "@/lib/routes";
import { positionsBounds, zoneAreaKm2, zoneVertices } from "@/lib/siteZone";
import {
  IMAGERY_PROVIDER_LABELS,
  SITE_MARGIN_KM,
  SITE_TYPE_LABELS,
  formatDistance,
  linkEventToSite,
  previousObservation,
  siteNearbyEventsPath,
  sitePath,
  zoneEmphasis,
  type Site,
  type SiteNearbyEvent,
} from "@/lib/sites";

const SiteMap = dynamic(() => import("@/components/map/SiteMap"), { ssr: false });

function nearbyCandidate(event: SiteNearbyEvent): LinkCandidate {
  const date = event.event_date ? formatDate(event.event_date) : "Undated";
  return { id: event.id, label: event.title, meta: `${date} · ${formatDistance(event.distance_m)} from the zone` };
}

export default function SitePage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const siteId = typeof params.id === "string" ? params.id : "";
  const { data: site, error, refetch } = useApiResource<Site>(siteId ? sitePath(siteId) : null);
  const nearby = useApiResource<SiteNearbyEvent[]>(site ? siteNearbyEventsPath(site.id) : null);
  const [shownId, setShownId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [linking, setLinking] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  const bounds = useMemo(() => {
    if (!site) return null;
    return positionsBounds([
      ...site.observations.flatMap((o) => zoneVertices(o.zone)),
      ...site.linked_events.map((e) => [e.event_coords.lng, e.event_coords.lat] as [number, number]),
    ]);
  }, [site]);

  if (error) return <PageError message={error} backHref="/map" />;
  if (!site || !bounds) return <PageLoading />;

  const latest = site.observations.at(-1)!;
  const shown = site.observations.find((o) => o.id === shownId) ?? latest;
  const previous = previousObservation(site.observations, shown.id);
  const refreshed = () => {
    refetch();
    nearby.refetch();
    setHistoryKey((k) => k + 1);
  };
  const myNearby = (nearby.data ?? []).filter((e) => e.owner.id === user?.id);

  const rail = (
    <div className="space-y-4">
      <Card as="section">
        <SectionEyebrow title="Actions" margin="none" />
        {user ? (
          <div className="flex flex-col gap-2">
            <Button variant="secondary" fullWidth onClick={() => setLinking(true)}>
              <Link2 size={14} />
              Link one of my events
            </Button>
            <Button variant="secondary" fullWidth onClick={() => setAdding(true)} disabled={adding}>
              <Plus size={14} />
              Add an observation
            </Button>
          </div>
        ) : (
          <p className="text-sm text-neutral-400">
            <Link href={`/login?next=${encodeURIComponent(sitePath(site.id))}`} className={TEXT_LINK}>
              Sign in
            </Link>{" "}
            to link an event or add an observation.
          </p>
        )}
      </Card>
      <DetailCard>
        <DetailRow label="Type" value={SITE_TYPE_LABELS[site.site_type]} />
        <DetailRow label="Owner">
          <AuthorByline author={site.owner} avatar />
        </DetailRow>
        <DetailRow label="Created" value={formatDate(site.created_at)} />
        <DetailRow label="Observations" value={site.observations.length} />
        <DetailRow label="Linked events" value={site.linked_events.length} />
        <DetailRow label="Analysts" concept="site_corroboration" value={site.corroboration_count} />
      </DetailCard>
    </div>
  );

  return (
    <PageShell
      back
      backFallback="/map"
      title={site.name}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="flex gap-1.5">
            <SiteTypePill type={site.site_type} />
            <CorroborationPill site={site} />
          </span>
          <span className="inline-flex items-center gap-1.5 text-sm text-neutral-400">
            Created by <AuthorByline author={site.owner} prefix={false} avatar />
          </span>
        </span>
      }
      rail={rail}
      railLabel="Site actions"
      narrowRail="below"
      headerInColumn
    >
      <div className="space-y-8">
        <div>
          <SectionEyebrow title="State" concept="site_last_observed" />
          <DetailCard>
            <DetailRow label="Last observed">
              <span className="text-sm text-neutral-200 text-right">
                {formatDate(site.observed_on)},{" "}
                {latest.imagery_url ? (
                  <OutboundLink href={latest.imagery_url} className={TEXT_LINK}>
                    {IMAGERY_PROVIDER_LABELS[site.imagery_provider]}
                  </OutboundLink>
                ) : (
                  IMAGERY_PROVIDER_LABELS[site.imagery_provider]
                )}
              </span>
            </DetailRow>
            <DetailRow label="Imagery shows" align="center">
              <ObservationEffectPill effect={site.observation_effect} />
            </DetailRow>
            {site.latest_link_effect && (
              <DetailRow label="Latest linked event" align="center">
                <span className="flex flex-wrap items-center justify-end gap-2 text-sm">
                  <Link href={eventHref(site.latest_link_effect.event_id)} className={TEXT_LINK}>
                    {site.latest_link_effect.event_date
                      ? formatDate(site.latest_link_effect.event_date)
                      : "Undated event"}
                  </Link>
                  <LinkEffectPill effect={site.latest_link_effect.effect} />
                </span>
              </DetailRow>
            )}
          </DetailCard>
          <p className="mt-2 text-xs text-neutral-500">
            Vidit records when the site was last seen, not whether it is in use today.
          </p>
        </div>

        {adding && (
          <AddObservationPanel
            site={site}
            onCancel={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              setShownId(null);
              refreshed();
            }}
          />
        )}

        <div>
          <SectionEyebrow title="Zone" concept="site_zone" />
          <div className="rounded-lg border border-neutral-700">
            <div className="h-80 overflow-hidden rounded-t-lg">
              <SiteMap
                zone={shown.zone}
                previousZone={previous?.zone ?? null}
                observationId={shown.id}
                emphasis={zoneEmphasis(site)}
                events={site.linked_events}
                bounds={bounds}
                onEventClick={(id) => router.push(eventHref(id))}
              />
            </div>
            <div className="space-y-1 rounded-b-lg border-t border-neutral-800 bg-neutral-900 px-4 py-3">
              <p className="text-sm text-neutral-200">
                {shown.id === latest.id ? "Latest zone" : "Zone"} of {formatDate(shown.captured_on)},{" "}
                {IMAGERY_PROVIDER_LABELS[shown.imagery_provider]} ·{" "}
                {zoneAreaKm2(zoneVertices(shown.zone)).toFixed(2)} km²
              </p>
              <p className={`${META_LINE} flex-wrap`}>
                {previous && <span>Dashed: the zone before it, {formatDate(previous.captured_on)}</span>}
                {site.linked_events.length > 0 && (
                  <>
                    <span>Dotted: a linked event outside the zone</span>
                    <span>Dimmed: an event measured against another zone</span>
                  </>
                )}
              </p>
            </div>
          </div>
        </div>

        <SiteHistory
          key={historyKey}
          site={site}
          shownObservationId={shown.id}
          onShowObservation={setShownId}
        />

        <section>
          <SectionEyebrow title="Nearby events, not linked" concept="site_nearby" />
          <p className="mb-3 text-sm text-neutral-400">
            A spatial computation, not a link: published events within {SITE_MARGIN_KM} km of the
            current zone that nobody has linked to this site. Only an event&apos;s owner can link it.
          </p>
          {nearby.data && nearby.data.length > 0 ? (
            <div className="space-y-2">
              {nearby.data.map((event) => (
                <LinkRow
                  key={event.id}
                  icon={MapPin}
                  variant="arrow"
                  external={false}
                  href={eventHref(event.id)}
                  value={event.title}
                  meta={`${event.event_date ? formatDate(event.event_date) : "Undated"} · ${event.owner.username} · ${
                    event.distance_m === 0 ? "inside the zone" : `${formatDistance(event.distance_m)} from the zone`
                  }`}
                />
              ))}
            </div>
          ) : nearby.data ? (
            <EmptyState variant="plain" lead="No unlinked event nearby." />
          ) : null}
        </section>
      </div>

      {linking && (
        <LinkDialog
          title="Link one of your events"
          subtitle={`${site.name} · ${SITE_TYPE_LABELS[site.site_type]}`}
          suggestedLabel={`Your events within ${SITE_MARGIN_KM} km, not linked yet`}
          emptySuggestions="None of your published events is near this site. Search one by title."
          suggestions={nearby.data ? myNearby.map(nearbyCandidate) : null}
          searchPlaceholder="Title of one of your geolocations"
          search={async (q) => {
            const linked = new Set(site.linked_events.map((e) => e.id));
            const { items } = await searchPickableEvents(user!.username, q);
            return items
              .filter((e) => e.status === "geolocated" && !linked.has(e.id))
              .map((e) => ({
                id: e.id,
                label: e.title,
                meta: e.event_date ? formatDate(e.event_date) : "Undated",
              }));
          }}
          onLink={async (eventId, effect) => {
            await linkEventToSite(eventId, site.id, effect);
            refreshed();
          }}
          onClose={() => setLinking(false)}
        />
      )}
    </PageShell>
  );
}
