"use client";

import { useClientPreference } from "@/hooks/useClientPreference";

import {
  BASEMAP_PRESET_IDS,
  DEFAULT_BASEMAP_OPTIONS,
  type BasemapOptions,
  type BasemapPresetId,
  type LabelDensity,
  type LabelLanguage,
} from "./basemap";

export interface BasemapSettings extends BasemapOptions {
  preset: BasemapPresetId;
}

const DEFAULT_BASEMAP_SETTINGS: BasemapSettings = {
  preset: "auto",
  ...DEFAULT_BASEMAP_OPTIONS,
};

const KEY = "vidit:basemap";
const EVENT = "vidit:basemap-changed";

const LANGUAGES: readonly LabelLanguage[] = ["latin", "local", "both"];
const DENSITIES: readonly LabelDensity[] = ["sparse", "normal"];

function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** A stored value read field by field: a missing or invalid field takes its default. */
function parse(raw: string | null): BasemapSettings {
  let stored: Record<string, unknown> = {};
  try {
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (value && typeof value === "object") stored = value as Record<string, unknown>;
  } catch {
    // An unreadable value reads as no value.
  }
  const d = DEFAULT_BASEMAP_SETTINGS;
  return {
    preset: pick(stored.preset, BASEMAP_PRESET_IDS, d.preset),
    language: pick(stored.language, LANGUAGES, d.language),
    density: pick(stored.density, DENSITIES, d.density),
    regionBorders: pick(stored.regionBorders, [true, false], d.regionBorders),
    roads: pick(stored.roads, [true, false], d.roads),
  };
}

// `localStorage` can be absent or throw (a private window, blocked site data). The settings then
// live in memory for the session. The snapshot keeps one object per stored string, as
// `useSyncExternalStore` requires.
let current = DEFAULT_BASEMAP_SETTINGS;
let currentRaw: string | null = null;
let storageWorks = true;

export function getBasemapSettings(): BasemapSettings {
  if (!storageWorks) return current;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw !== currentRaw) {
      currentRaw = raw;
      current = parse(raw);
    }
  } catch {
    storageWorks = false;
  }
  return current;
}

export function saveBasemapSettings(patch: Partial<BasemapSettings>): void {
  current = { ...getBasemapSettings(), ...patch };
  currentRaw = JSON.stringify(current);
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
