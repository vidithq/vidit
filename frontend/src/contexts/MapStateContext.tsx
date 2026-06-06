"use client";

import { createContext, useContext, useMemo, useState, ReactNode } from "react";

/**
 * Persistent map-page state that survives navigation away and back.
 *
 * The home page lives at /; navigating to /profile/<x> or /geolocations/<x>
 * unmounts /page.tsx and would lose its useState. By lifting state into a
 * context provider that lives in the root layout (Providers), the state
 * survives. Coming back from a deep page restores the previous view, the
 * selected point, and the filter set.
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
  // Map view (pan + zoom). Updated whenever the user pans or zooms.
  viewState: ViewState;
  setViewState: (v: ViewState) => void;

  // Selected geolocation (controls the detail panel).
  selectedId: string | null;
  setSelectedId: (v: string | null) => void;

  // Filters — every tag bucket is multi-select. Within a bucket the
  // server applies OR (any-of); across buckets it applies AND (a geo
  // must satisfy each bucket independently). See `routers/geolocations.py::_apply_filters`.
  selectedConflicts: string[];
  setSelectedConflicts: (v: string[] | ((prev: string[]) => string[])) => void;
  selectedCaptureSources: string[];
  setSelectedCaptureSources: (v: string[] | ((prev: string[]) => string[])) => void;
  selectedTags: string[];
  setSelectedTags: (v: string[] | ((prev: string[]) => string[])) => void;
  eventDateFrom: string;
  setEventDateFrom: (v: string) => void;
  eventDateTo: string;
  setEventDateTo: (v: string) => void;
  submittedFrom: string;
  setSubmittedFrom: (v: string) => void;
  submittedTo: string;
  setSubmittedTo: (v: string) => void;
  authorFilter: string;
  setAuthorFilter: (v: string) => void;

  // UI state
  filtersOpen: boolean;
  setFiltersOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
}

const MapStateContext = createContext<MapState | null>(null);

export function MapStateProvider({ children }: { children: ReactNode }) {
  const [viewState, setViewState] = useState<ViewState>(DEFAULT_VIEW_STATE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedConflicts, setSelectedConflicts] = useState<string[]>([]);
  const [selectedCaptureSources, setSelectedCaptureSources] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [eventDateFrom, setEventDateFrom] = useState("");
  const [eventDateTo, setEventDateTo] = useState("");
  const [submittedFrom, setSubmittedFrom] = useState("");
  const [submittedTo, setSubmittedTo] = useState("");
  const [authorFilter, setAuthorFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(true);

  // Memoised so the value object is referentially stable across renders that
  // don't actually change any state slot. React re-runs every consumer when
  // the value identity changes, so unmemoised this would re-render every
  // useContext consumer on every keystroke even if nothing they read moved.
  const value = useMemo<MapState>(
    () => ({
      viewState,
      setViewState,
      selectedId,
      setSelectedId,
      selectedConflicts,
      setSelectedConflicts,
      selectedCaptureSources,
      setSelectedCaptureSources,
      selectedTags,
      setSelectedTags,
      eventDateFrom,
      setEventDateFrom,
      eventDateTo,
      setEventDateTo,
      submittedFrom,
      setSubmittedFrom,
      submittedTo,
      setSubmittedTo,
      authorFilter,
      setAuthorFilter,
      filtersOpen,
      setFiltersOpen,
    }),
    [
      viewState,
      selectedId,
      selectedConflicts,
      selectedCaptureSources,
      selectedTags,
      eventDateFrom,
      eventDateTo,
      submittedFrom,
      submittedTo,
      authorFilter,
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
