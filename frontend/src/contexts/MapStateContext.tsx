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

import { EMPTY_FILTERS, type FilterState } from "@/components/filters/model";

/** Map-page state that survives navigating away and back: lifted into the root layout's
 * provider so returning from a deep page restores the view, selected point and filters. */

interface ViewState {
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

  /** The filter panel's state. Server side: OR within a list, AND across. The Show pick and the
   *  two date windows filter in memory with no refetch: the points payload flags each row
   *  (`POINT_DETECTED_FLAG`) and carries its event date (point[3]) and added date (point[4]).
   *  `site` in `show` is the Show field's Sites chip. */
  filters: FilterState;
  setFilters: Dispatch<SetStateAction<FilterState>>;

  eventPlaying: boolean;
  setEventPlaying: (v: boolean | ((prev: boolean) => boolean)) => void;
  addedPlaying: boolean;
  setAddedPlaying: (v: boolean | ((prev: boolean) => boolean)) => void;


  /** The site whose panel is open. */
  selectedSiteId: string | null;
  setSelectedSiteId: (v: string | null) => void;
}

const MapStateContext = createContext<MapState | null>(null);

export function MapStateProvider({ children }: { children: ReactNode }) {
  const [viewState, setViewState] = useState<ViewState>(DEFAULT_VIEW_STATE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [eventPlaying, setEventPlaying] = useState(false);
  const [addedPlaying, setAddedPlaying] = useState(false);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);

  // Memoised so consumers re-render only when a slot they read changes.
  const value = useMemo<MapState>(
    () => ({
      viewState,
      setViewState,
      selectedId,
      setSelectedId,
      filters,
      setFilters,
      eventPlaying,
      setEventPlaying,
      addedPlaying,
      setAddedPlaying,
      selectedSiteId,
      setSelectedSiteId,
    }),
    [
      viewState,
      selectedId,
      filters,
      eventPlaying,
      addedPlaying,
      selectedSiteId,
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
