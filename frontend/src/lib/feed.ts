import { EMPTY_FILTERS, type FilterState } from "@/components/filters/model";
import type { PageUrl } from "@/components/filters/useFilterSurface";
import { appendEventFilterParams, readEventFilterParams } from "./search";

/** The feed page's URL: the `GET /events` filter vocabulary, with `scope=all` while Following is
 *  off. Following is on unless the URL says `scope=all`. */
export const FEED_PAGE: PageUrl<FilterState> = {
  path: "/feed",
  read: (params) => ({
    ...EMPTY_FILTERS,
    ...readEventFilterParams(params),
    following: params.get("scope") !== "all",
  }),
  write: (state) => {
    const params = new URLSearchParams();
    if (!state.following) params.set("scope", "all");
    appendEventFilterParams(params, state);
    return params;
  },
};

/** The `GET /feed` query for a filter state: `scope` and the `GET /events` filters. */
function feedQuery(state: FilterState): URLSearchParams {
  const params = new URLSearchParams({ scope: state.following ? "following" : "all" });
  appendEventFilterParams(params, state);
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
