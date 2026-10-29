"use client";

import { storedJson } from "@/hooks/storedJson";
import { useClientPreference } from "@/hooks/useClientPreference";
import { useTheme } from "@/hooks/useTheme";

import {
  BASEMAP_PRESETS,
  BASEMAP_PRESET_IDS,
  DEFAULT_BASEMAP_OPTIONS,
  LABEL_DENSITIES,
  LABEL_LANGUAGES,
  resolvePreset,
  type BasemapOptions,
  type BasemapPresetId,
  type Brightness,
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

const BOOLEAN: readonly boolean[] = [true, false];

/** Every stored field with the values it may take. A field added here reads as its default from a
 *  value stored before it existed. */
const FIELDS: { [K in keyof BasemapSettings]: readonly BasemapSettings[K][] } = {
  preset: BASEMAP_PRESET_IDS,
  language: LABEL_LANGUAGES,
  density: LABEL_DENSITIES,
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
function storedChoices(value: unknown): Partial<BasemapSettings> {
  const stored = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const keys = Object.keys(FIELDS) as (keyof BasemapSettings)[];
  return Object.fromEntries(
    keys.flatMap((key) => {
      const allowed: readonly unknown[] = FIELDS[key];
      return allowed.includes(stored[key]) ? [[key, stored[key]]] : [];
    }),
  ) as Partial<BasemapSettings>;
}

const choices = storedJson<Partial<BasemapSettings>>(KEY, {}, storedChoices);
// One settings object per stored choices, as `useSyncExternalStore` requires.
let merged = { choices: {} as Partial<BasemapSettings>, settings: DEFAULT_BASEMAP_SETTINGS };

/** The stored choices over the defaults: a field the reader never set follows the default. */
export function getBasemapSettings(): BasemapSettings {
  const read = choices.read();
  if (read !== merged.choices) {
    merged = { choices: read, settings: { ...DEFAULT_BASEMAP_SETTINGS, ...read } };
  }
  return merged.settings;
}

/** Stores the patch with the earlier choices, and only those, so a changed default reaches every
 *  field the reader never set. */
export function saveBasemapSettings(patch: Partial<BasemapSettings>): void {
  choices.write({ ...choices.read(), ...patch });
}

/** The reader's basemap preset and options, kept in this browser. */
export function useBasemapSettings(): [BasemapSettings, (patch: Partial<BasemapSettings>) => void] {
  const settings = useClientPreference(
    getBasemapSettings,
    choices.event,
    () => DEFAULT_BASEMAP_SETTINGS,
  );
  return [settings, saveBasemapSettings];
}

/** The brightness of the basemap on show, which the overlays drawn over it read their colours by. */
export function useBasemapBrightness(): Brightness {
  const [settings] = useBasemapSettings();
  return BASEMAP_PRESETS[resolvePreset(settings.preset, useTheme())].brightness;
}
