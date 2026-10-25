"use client";

import Link from "next/link";

import { AuthorByline } from "@/components/ui/AuthorByline";
import { DetailCard, DetailRow } from "@/components/ui/DetailRow";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { TEXT_LINK } from "@/components/ui/styles";
import { useApiResource } from "@/hooks/useApiResource";
import { formatDate } from "@/lib/format";
import { eventHref } from "@/lib/routes";
import {
  LINK_EFFECT_LABELS,
  SITE_KIND_LABELS,
  siteHistoryPath,
  type HistoryOrder,
  type SiteHistoryEntry,
} from "@/lib/sites";

type ChangeKind = Extract<
  SiteHistoryEntry["kind"],
  "record_edited" | "event_unlinked" | "link_effect_changed"
>;

function sentence(entry: SiteHistoryEntry) {
  const { record, previous_record: before, event } = entry;
  if (entry.kind === "record_edited" && record && before) {
    const parts = [
      record.name !== before.name && `Renamed from ${before.name}`,
      record.kind !== before.kind &&
        `Kind changed from ${SITE_KIND_LABELS[before.kind]} to ${SITE_KIND_LABELS[record.kind]}`,
    ].filter(Boolean);
    return <span>{parts.join(". ")}</span>;
  }
  const title = event && (
    <Link href={eventHref(event.id)} className={TEXT_LINK}>
      {event.title}
    </Link>
  );
  if (entry.kind === "link_effect_changed" && entry.link_effect && entry.previous_link_effect) {
    return (
      <span>
        {title}: effect changed from {LINK_EFFECT_LABELS[entry.previous_link_effect]} to{" "}
        {LINK_EFFECT_LABELS[entry.link_effect]}
      </span>
    );
  }
  return (
    <span>
      {title} unlinked{entry.link_effect ? `, its effect was ${LINK_EFFECT_LABELS[entry.link_effect]}` : ""}
    </span>
  );
}

/**
 * The changes a view's rows do not show, from the site's history (`GET /sites/{id}/history`):
 * the record's renames and kind changes under the imagery history, and the unlinks and effect
 * changes under the linked events. Nothing on a site is overwritten, so each stays on record.
 * Newest first on the page's clock. Renders nothing without one.
 */
export function SiteChanges({
  siteId,
  kinds,
  order,
}: {
  siteId: string;
  kinds: ChangeKind[];
  order: HistoryOrder;
}) {
  const { data } = useApiResource<SiteHistoryEntry[]>(siteHistoryPath(siteId, order));
  const changes = (data ?? []).filter((entry) => (kinds as string[]).includes(entry.kind)).reverse();
  if (changes.length === 0) return null;
  return (
    <section>
      <SectionEyebrow title="Changes on record" />
      <DetailCard>
        {changes.map((entry, i) => (
          <DetailRow
            key={`${entry.kind}-${entry.recorded_at}-${i}`}
            align="start"
            label={formatDate(order === "fact" && entry.fact_date ? entry.fact_date : entry.recorded_at)}
          >
            <span className="flex flex-col items-end gap-1 text-right text-sm text-neutral-200">
              {sentence(entry)}
              {entry.actor && <AuthorByline author={entry.actor} size="xs" className="text-xs" />}
            </span>
          </DetailRow>
        ))}
      </DetailCard>
    </section>
  );
}
