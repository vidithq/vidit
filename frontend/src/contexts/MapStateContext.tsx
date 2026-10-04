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

/** Map-page state that survives navigating away and back: lifted into the root layout's
 * provider so returning from a deep page restores the view, selected point and filters. */

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

  /** The shared filter vocabulary in the filter panel's shape. Server side: OR within a tag
   *  bucket, AND across (`routers/events::_apply_filters`). The lifecycle status pick is the
   *  exception: the points payload flags each row (`POINT_DETECTED_FLAG`), so it filters in
   *  memory with no refetch. */
  filters: EventFilterValues;
  setFilters: Dispatch<SetStateAction<EventFilterValues>>;

  /** Event date (point[3]) and Added (point[4]); both filter client side, so dragging and
   *  playback never refetch. */
  dateWindows: DateWindows;
  setDateWindows: Dispatch<SetStateAction<DateWindows>>;
  eventPlaying: boolean;
  setEventPlaying: (v: boolean | ((prev: boolean) => boolean)) => void;
  addedPlaying: boolean;
  setAddedPlaying: (v: boolean | ((prev: boolean) => boolean)) => void;

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
  // Collapsed by default: the map leads with the catalogue; ActiveFilterPills still surfaces
  // active filters.
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Memoised so consumers re-render only when a slot they read changes.
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
