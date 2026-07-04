import { StatusBadge } from "@/components/event/StatusBadge";
import { EntityCard } from "@/components/ui/EntityCard";
import { sourceIsSynthetic } from "@/lib/events";
import type { EventDetail } from "@/types";

/**
 * One machine-`detected` row in the owner detections list. Like every other
 * catalogue card it's just a click — here, to the edit/submit form, where the
 * owner reviews and then submits or rejects it. The Edit / Reject controls live
 * on that form, not inline, so the queue cards behave like the rest of the app.
 */
export default function DetectionCard({ geo }: { geo: EventDetail }) {
  return (
    <EntityCard
      variant="compact"
      detailHref={`/events/${geo.id}/edit`}
      title={geo.title}
      author={geo.owner}
      badge={<StatusBadge status={geo.status} />}
      media={geo.media[0]}
      date={geo.event_date ?? undefined}
      coords={geo.event_coords}
      source={
        geo.detected_from_url
          ? { url: geo.detected_from_url, isDemo: sourceIsSynthetic(geo) }
          : undefined
      }
      tags={geo.tags}
    />
  );
}
