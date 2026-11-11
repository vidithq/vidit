import type { Collection } from "@/lib/collections";
import type { EventListItem } from "@/types";
import { OWNER } from "./eventDetail";

/** Ana's five-event collection, changed by `overrides`. */
export const collection = (overrides: Partial<Collection> = {}): Collection => ({
  id: "c1",
  owner: OWNER,
  title: "Kupiansk rail corridor",
  description: "<p>Three days of strikes on the eastern approach.</p>",
  description_text: "Three days of strikes on the eastern approach.",
  cover: [],
  tags: [],
  event_count: 5,
  first_date: "2026-03-14",
  last_date: "2026-03-16",
  created_at: "2026-03-21T09:00:00Z",
  hidden_at: null,
  ...overrides,
});

/** One of Ana's geolocated events as a list, and the collection picker, show it, changed by
 *  `overrides`. */
export const eventRow = (
  id: string,
  title: string,
  overrides: Partial<EventListItem> = {},
): EventListItem => ({
  id,
  title,
  status: "geolocated",
  occurred_date: "2026-03-14",
  coords: { lat: 49.71, lng: 37.616 },
  before_closed_status: null,
  requested_at: null,
  conflicts: [],
  is_graphic: false,
  media: null,
  owner: OWNER,
  geolocators: [],
  tags: [],
  ...overrides,
});
