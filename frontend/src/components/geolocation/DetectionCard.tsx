import StatusBadge from "@/components/geolocation/StatusBadge";
import { EntityCard } from "@/components/ui/EntityCard";
import { sourceIsSynthetic } from "@/lib/geolocations";
import type { GeolocationDetail } from "@/types";

/**
 * One machine-`detected` row in the owner detections list. Like every other
 * catalogue card it's just a click — here, to the edit/submit form, where the
 * owner reviews and then submits or rejects it. The Edit / Reject controls live
 * on that form, not inline, so the queue cards behave like the rest of the app.
 */
export default function DetectionCard({ geo }: { geo: GeolocationDetail }) {
  return (
    <EntityCard
      variant="compact"
      detailHref={`/geolocations/${geo.id}/edit`}
      title={geo.title}
      titleText={geo.title}
      author={geo.author}
      badge={<StatusBadge status={geo.status} />}
      media={geo.media[0]}
      date={geo.event_date}
      coords={{ lat: geo.lat, lng: geo.lng }}
      source={
        geo.detected_from_url
          ? { url: geo.detected_from_url, isDemo: sourceIsSynthetic(geo) }
          : undefined
      }
      tags={geo.tags}
    />
  );
}
