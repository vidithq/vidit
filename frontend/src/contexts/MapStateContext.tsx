"use client";

import { createContext, useContext, useMemo, useState, ReactNode } from "react";

/**
 * Persistent map-page state that survives navigation away and back.
 *
 * The home page lives at /; navigating to /profile/<x> or /events/<x>
 * unmounts /page.tsx and would lose its useState. Lifting state into a
 * context provider in the root layout (Providers) keeps it, so returning
 * from a deep page restores the view, selected point, and filter set.
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

  // Filters — every tag bucket is multi-select. Within a bucket the server
  // applies OR (any-of); across buckets AND (a geo must satisfy each bucket
  // independently). See `routers/events::_apply_filters`.
  // Lifecycle status: geolocated / detected, the two the map serves. The
  // points payload already flags each row (`POINT_DETECTED_FLAG`), so the
  // chips filter client-side like the timelines, no refetch per pick.
  selectedStatuses: string[];
  setSelectedStatuses: (v: string[] | ((prev: string[]) => string[])) => void;
  selectedConflicts: string[];
  setSelectedConflicts: (v: string[] | ((prev: string[]) => string[])) => void;
  selectedCaptureSources: string[];
  setSelectedCaptureSources: (v: string[] | ((prev: string[]) => string[])) => void;
  selectedTags: string[];
  setSelectedTags: (v: string[] | ((prev: string[]) => string[])) => void;
  // Media presence — image / video; a geo matches if it has any attachment of
  // a selected type. ``trustedOnly`` / ``hideDemo`` are global quality toggles.
  selectedMediaTypes: string[];
  setSelectedMediaTypes: (v: string[] | ((prev: string[]) => string[])) => void;
  trustedOnly: boolean;
  setTrustedOnly: (v: boolean | ((prev: boolean) => boolean)) => void;
  hideDemo: boolean;
  setHideDemo: (v: boolean | ((prev: boolean) => boolean)) => void;

  // Two timeline windows — Event date (event_date, point[3]) and Submitted
  // date (created_at, point[4]). Each is an active date range filtered
  // client-side from the per-point dates, so dragging and playback never
  // refetch. Empty string = open at that edge (snaps to the data's min/max).
  eventStart: string;
  setEventStart: (v: string) => void;
  eventEnd: string;
  setEventEnd: (v: string) => void;
  eventPlaying: boolean;
  setEventPlaying: (v: boolean | ((prev: boolean) => boolean)) => void;
  submittedStart: string;
  setSubmittedStart: (v: string) => void;
  submittedEnd: string;
  setSubmittedEnd: (v: string) => void;
  submittedPlaying: boolean;
  setSubmittedPlaying: (v: boolean | ((prev: boolean) => boolean)) => void;

  authorFilter: string;
  setAuthorFilter: (v: string) => void;

  filtersOpen: boolean;
  setFiltersOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
}

const MapStateContext = createContext<MapState | null>(null);

export function MapStateProvider({ children }: { children: ReactNode }) {
  const [viewState, setViewState] = useState<ViewState>(DEFAULT_VIEW_STATE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedConflicts, setSelectedConflicts] = useState<string[]>([]);
  const [selectedCaptureSources, setSelectedCaptureSources] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedMediaTypes, setSelectedMediaTypes] = useState<string[]>([]);
  const [trustedOnly, setTrustedOnly] = useState(false);
  const [hideDemo, setHideDemo] = useState(false);
  const [eventStart, setEventStart] = useState("");
  const [eventEnd, setEventEnd] = useState("");
  const [eventPlaying, setEventPlaying] = useState(false);
  const [submittedStart, setSubmittedStart] = useState("");
  const [submittedEnd, setSubmittedEnd] = useState("");
  const [submittedPlaying, setSubmittedPlaying] = useState(false);
  const [authorFilter, setAuthorFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(true);

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
      selectedStatuses,
      setSelectedStatuses,
      selectedConflicts,
      setSelectedConflicts,
      selectedCaptureSources,
      setSelectedCaptureSources,
      selectedTags,
      setSelectedTags,
      selectedMediaTypes,
      setSelectedMediaTypes,
      trustedOnly,
      setTrustedOnly,
      hideDemo,
      setHideDemo,
      eventStart,
      setEventStart,
      eventEnd,
      setEventEnd,
      eventPlaying,
      setEventPlaying,
      submittedStart,
      setSubmittedStart,
      submittedEnd,
      setSubmittedEnd,
      submittedPlaying,
      setSubmittedPlaying,
      authorFilter,
      setAuthorFilter,
      filtersOpen,
      setFiltersOpen,
    }),
    [
      viewState,
      selectedId,
      selectedStatuses,
      selectedConflicts,
      selectedCaptureSources,
      selectedTags,
      selectedMediaTypes,
      trustedOnly,
      hideDemo,
      eventStart,
      eventEnd,
      eventPlaying,
      submittedStart,
      submittedEnd,
      submittedPlaying,
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
