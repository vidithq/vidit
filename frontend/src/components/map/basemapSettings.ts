"use client";

import { useClientPreference } from "@/hooks/useClientPreference";
import { useTheme } from "@/hooks/useTheme";

import {
  BASEMAP_PRESETS,
  BASEMAP_PRESET_IDS,
  DEFAULT_BASEMAP_OPTIONS,
  resolvePreset,
  type BasemapOptions,
  type BasemapPresetId,
  type Brightness,
  type LabelDensity,
  type LabelLanguage,
} from "./basemap";

/** What the map draws over any preset, each from a source of its own. */
export interface OverlayOptions {
  grid: boolean;
  dailyImagery: boolean;
  fires: boolean;
}

export interface BasemapSettings extends BasemapOptions, OverlayOptions {
  preset: BasemapPresetId;
}

const DEFAULT_BASEMAP_SETTINGS: BasemapSettings = {
  preset: "auto",
  ...DEFAULT_BASEMAP_OPTIONS,
  grid: false,
  dailyImagery: false,
  fires: false,
};

const KEY = "vidit:basemap";
const EVENT = "vidit:basemap-changed";

const BOOLEAN: readonly boolean[] = [true, false];

/** Every stored field with the values it may take. A field added here reads as its default from a
 *  value stored before it existed. */
const FIELDS: { [K in keyof BasemapSettings]: readonly BasemapSettings[K][] } = {
  preset: BASEMAP_PRESET_IDS,
  language: ["latin", "local", "both"] satisfies LabelLanguage[],
  density: ["sparse", "normal"] satisfies LabelDensity[],
  regionBorders: BOOLEAN,
  roads: BOOLEAN,
  buildings: BOOLEAN,
  militaryAndAirports: BOOLEAN,
  relief: BOOLEAN,
  disputedDashed: BOOLEAN,
  grid: BOOLEAN,
  dailyImagery: BOOLEAN,
  fires: BOOLEAN,
};

/** The fields a stored value sets to a valid value: the reader's own choices. */
function storedChoices(raw: string | null): Partial<BasemapSettings> {
  let stored: Record<string, unknown> = {};
  try {
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (value && typeof value === "object") stored = value as Record<string, unknown>;
  } catch {
    // An unreadable value reads as no value.
  }
  const keys = Object.keys(FIELDS) as (keyof BasemapSettings)[];
  return Object.fromEntries(
    keys.flatMap((key) => {
      const allowed: readonly unknown[] = FIELDS[key];
      return allowed.includes(stored[key]) ? [[key, stored[key]]] : [];
    }),
  ) as Partial<BasemapSettings>;
}

// `localStorage` can be absent or throw (a private window, blocked site data). The settings then
// live in memory for the session. The snapshot keeps one object per stored string, as
// `useSyncExternalStore` requires.
let current = DEFAULT_BASEMAP_SETTINGS;
let currentRaw: string | null = null;
let currentChoices: Partial<BasemapSettings> = {};
let storageWorks = true;

/** The stored choices over the defaults: a field the reader never set follows the default. */
export function getBasemapSettings(): BasemapSettings {
  if (!storageWorks) return current;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw !== currentRaw) {
      currentRaw = raw;
      currentChoices = storedChoices(raw);
      current = { ...DEFAULT_BASEMAP_SETTINGS, ...currentChoices };
    }
  } catch {
    storageWorks = false;
  }
  return current;
}

/** Stores the patch with the earlier choices, and only those, so a changed default reaches every
 *  field the reader never set. */
export function saveBasemapSettings(patch: Partial<BasemapSettings>): void {
  getBasemapSettings();
  currentChoices = { ...currentChoices, ...patch };
  current = { ...DEFAULT_BASEMAP_SETTINGS, ...currentChoices };
  currentRaw = JSON.stringify(currentChoices);
  try {
    window.localStorage.setItem(KEY, currentRaw);
  } catch {
    storageWorks = false;
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The reader's basemap preset and options, kept in this browser. */
export function useBasemapSettings(): [BasemapSettings, (patch: Partial<BasemapSettings>) => void] {
  const settings = useClientPreference(getBasemapSettings, EVENT, () => DEFAULT_BASEMAP_SETTINGS);
  return [settings, saveBasemapSettings];
}

/** The brightness of the basemap on show, which the overlays drawn over it read their colours by. */
export function useBasemapBrightness(): Brightness {
  const [settings] = useBasemapSettings();
  return BASEMAP_PRESETS[resolvePreset(settings.preset, useTheme())].brightness;
}
