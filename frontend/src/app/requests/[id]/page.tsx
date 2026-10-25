"use client";

import { EventReadPage } from "@/components/event/EventReadPage";

/**
 * A request is a `requested` event (see `docs/data-model.md`, `events`) served by
 * `GET /events/{id}`, read on the event page's shell with the request's actions (Edit, Share,
 * Report, then Geolocate). The owner closes it from the edit page.
 */
export default function RequestDetailPage() {
  return <EventReadPage surface="request" />;
}
