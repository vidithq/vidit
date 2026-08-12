"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import {
  EMPTY_DATE_WINDOWS,
  EMPTY_EVENT_FILTERS,
  type DateWindows,
  type EventFilterValues,
} from "@/components/filters/EventFilterSections";

/**
 * Persistent map-page state that survives navigation away and back.
 *
 * The map lives at /map; navigating to /profile/<x> or /events/<x> unmounts the
 * page and would lose its useState. Lifting state into a context provider in the
 * root layout (Providers) keeps it, so returning from a deep page restores the
 * view, selected point, and filter set.
 */

export interface ViewState {
  latitude: number;
  longitude: number;
  zoom: number;
}

const DEFAULT_VIEW_STATE: ViewState = {
  latitude: 48.5,
  longitude: 35.0,
  zoom: 5,
};

interface MapState {
  viewState: ViewState;
  setViewState: (v: ViewState) => void;

  selectedId: string | null;
  setSelectedId: (v: string | null) => void;

  /** The shared event-filter vocabulary, in the same shape the filter panel
   *  speaks (`EventFilterValues`), so the map hands it straight through. Every
   *  tag bucket is multi-select: the server applies OR within a bucket and AND
   *  across them (see `routers/events::_apply_filters`). The lifecycle status
   *  pick is the exception, applied client-side: the points payload already
   *  flags each row (`POINT_DETECTED_FLAG`), so status chips filter in memory
   *  with no refetch. */
  filters: EventFilterValues;
  setFilters: Dispatch<SetStateAction<EventFilterValues>>;

  /** Event date (event_date, point[3]) and Added (created_at, point[4]). Both
   *  filter client-side off the per-point dates, so dragging and playback never
   *  refetch. */
  dateWindows: DateWindows;
  setDateWindows: Dispatch<SetStateAction<DateWindows>>;
  eventPlaying: boolean;
  setEventPlaying: (v: boolean | ((prev: boolean) => boolean)) => void;
  addedPlaying: boolean;
  setAddedPlaying: (v: boolean | ((prev: boolean) => boolean)) => void;

  /** Global toggle, not part of the shared vocabulary: the map is the only
   *  surface that serves demo rows. */
  hideDemo: boolean;
  setHideDemo: (v: boolean | ((prev: boolean) => boolean)) => void;

  filtersOpen: boolean;
  setFiltersOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
}

const MapStateContext = createContext<MapState | null>(null);

export function MapStateProvider({ children }: { children: ReactNode }) {
  const [viewState, setViewState] = useState<ViewState>(DEFAULT_VIEW_STATE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<EventFilterValues>(EMPTY_EVENT_FILTERS);
  const [dateWindows, setDateWindows] = useState<DateWindows>(EMPTY_DATE_WINDOWS);
  const [eventPlaying, setEventPlaying] = useState(false);
  const [addedPlaying, setAddedPlaying] = useState(false);
  const [hideDemo, setHideDemo] = useState(false);
  // Collapsed by default: the map leads with the catalogue, and the pills row
  // (ActiveFilterPills) still surfaces any active filter while collapsed.
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Memoised for a referentially-stable value across renders that don't
  // change any state slot. React re-runs every consumer on value-identity
  // change, so unmemoised this would re-render every consumer on every
  // keystroke even if nothing they read moved.
  const value = useMemo<MapState>(
    () => ({
      viewState,
      setViewState,
      selectedId,
      setSelectedId,
      filters,
      setFilters,
      dateWindows,
      setDateWindows,
      eventPlaying,
      setEventPlaying,
      addedPlaying,
      setAddedPlaying,
      hideDemo,
      setHideDemo,
      filtersOpen,
      setFiltersOpen,
    }),
    [
      viewState,
      selectedId,
      filters,
      dateWindows,
      eventPlaying,
      addedPlaying,
      hideDemo,
      filtersOpen,
    ]
  );

  return (
    <MapStateContext.Provider value={value}>
      {children}
    </MapStateContext.Provider>
  );
}

export function useMapState(): MapState {
  const ctx = useContext(MapStateContext);
  if (!ctx) {
    throw new Error("useMapState must be used inside MapStateProvider");
  }
  return ctx;
}
