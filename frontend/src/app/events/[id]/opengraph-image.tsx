import { EVENT_STATUS_META } from "@/components/event/StatusBadge";
import { formatCoordinates } from "@/lib/coordinates";
import { formatDate } from "@/lib/format";
import { ogTruncate } from "@/lib/og";
import type { EventDetail } from "@/types";

import {
  OG_COLOR,
  OG_CONTENT_TYPE,
  OG_SIZE,
  OgBadge,
  OgCard,
  ogFailedReadResponse,
  ogImageResponse,
} from "../../_og/card";
import { OgMiniMap } from "../../_og/MiniMap";
import { ogFetch } from "../../_og/data";

// `og:image` for `/events/{id}`: the geolocation as a share card. One read of
// `GET /events/{id}`, the same anonymous payload the page renders from, so the
// card can only ever show what a signed-out visitor already sees; a
// soft-deleted event 404s upstream and lands on the fallback below. A demo row
// carries its badge here exactly as it does on the page, so a synthetic event
// stays labelled once its link leaves the site.

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "A geolocation on Vidit: title, coordinates, and the analyst who filed it.";

/** Two lines of title at the card's heading size. */
const TITLE_MAX = 76;

// Near the 2:1 of the world it frames, and sized so a two-line title still
// clears the footer.
const MAP_WIDTH = 480;
const MAP_HEIGHT = 232;

function EventBadges({ event }: { event: EventDetail }) {
  // Word and emphasis come from `EVENT_STATUS_META`, the same map the page's
  // `<StatusBadge>` renders from, so the card cannot call a row by a name the
  // page never uses. The map is total over `EventStatus`, so there is nothing
  // to fall back to.
  const { label, tone } = EVENT_STATUS_META[event.status];
  return (
    <div style={{ display: "flex", gap: "12px" }}>
      {/* Synthetic rows are labelled first: a demo link that leaves the site
          must not read as catalog evidence. */}
      {event.is_demo ? <OgBadge label="Demo" /> : null}
      <OgBadge label={label} tone={tone} />
    </div>
  );
}

function NotFoundCard() {
  return (
    <OgCard>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ display: "flex", fontSize: "72px", color: OG_COLOR.text }}>
          No event here
        </div>
        <div style={{ display: "flex", marginTop: "20px", fontSize: "30px", color: OG_COLOR.muted }}>
          This link points at nothing in the catalog.
        </div>
      </div>
    </OgCard>
  );
}

export default async function EventOpenGraphImage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const read = await ogFetch<EventDetail>(`/events/${encodeURIComponent(id)}`);

  if (read.status === "missing") {
    return ogImageResponse(<NotFoundCard />);
  }
  // A read that failed rather than answered says nothing about the link, so the
  // card says nothing about it either.
  if (read.status === "failed") {
    return ogFailedReadResponse();
  }

  const event = read.data;
  const coords = event.event_coords;
  const byline = [
    `@${ogTruncate(event.owner.username, 24)}`,
    event.event_date ? formatDate(event.event_date) : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  return ogImageResponse(
    <OgCard badge={<EventBadges event={event} />}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", fontSize: "48px", lineHeight: 1.15, color: OG_COLOR.text }}>
          {ogTruncate(event.title, TITLE_MAX)}
        </div>

        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, paddingRight: "40px" }}>
            {coords ? (
              <div style={{ display: "flex", fontSize: "34px", color: OG_COLOR.accent }}>
                {formatCoordinates(coords.lat, coords.lng)}
              </div>
            ) : null}
            <div
              style={{
                display: "flex",
                marginTop: coords ? "16px" : "0px",
                fontSize: "26px",
                color: OG_COLOR.muted,
              }}
            >
              {byline}
            </div>
          </div>

          {/* A coordless row (a request served by id) has no point to frame, so
              the locator panel is omitted rather than drawn empty. */}
          {coords ? (
            <OgMiniMap
              lat={coords.lat}
              lng={coords.lng}
              width={MAP_WIDTH}
              height={MAP_HEIGHT}
            />
          ) : null}
        </div>
      </div>
    </OgCard>,
  );
}
