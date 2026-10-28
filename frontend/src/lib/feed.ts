import { EMPTY_FILTERS, type FilterState } from "@/components/filters/model";
import type { operations } from "./api-types";
import { appendEventFilterParams, readEventFilterParams } from "./search";

type FeedQuery = NonNullable<operations["get_feed_api_v1_feed_get"]["parameters"]["query"]>;
type FeedKind = NonNullable<FeedQuery["kind"]>[number];

// `GET /feed` takes the Show filter as `kind`, one value per status.
const FEED_KINDS: Record<string, FeedKind> = {
  requested: "request",
  detected: "detected",
  geolocated: "geolocation",
};

/** The feed page's URL for its filters: the `GET /events` vocabulary, with `scope=all` while
 *  Following is off. */
export function feedPageParams(state: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (!state.following) params.set("scope", "all");
  appendEventFilterParams(params, state);
  return params;
}

/** The filters a feed URL names; Following is on unless the URL says `scope=all`. */
export function readFeedPage(params: URLSearchParams): FilterState {
  return {
    ...EMPTY_FILTERS,
    ...readEventFilterParams(params),
    following: params.get("scope") !== "all",
  };
}

/** The `GET /feed` query for a filter state: `scope`, the Show pick as `kind`, the rest as on
 *  `GET /events`. */
function feedQuery(state: FilterState): URLSearchParams {
  const params = new URLSearchParams({ scope: state.following ? "following" : "all" });
  state.show.forEach((status) => {
    if (FEED_KINDS[status]) params.append("kind", FEED_KINDS[status]);
  });
  appendEventFilterParams(params, { ...state, show: [] });
  return params;
}

/** One page of `GET /feed`. */
export function feedPath(state: FilterState, cursor: string | null): string {
  const params = feedQuery(state);
  if (cursor) params.set("cursor", cursor);
  return `/feed?${params}`;
}

/** `GET /feed/dates` for the same filters. */
export const feedDatesPath = (state: FilterState): string => `/feed/dates?${feedQuery(state)}`;
