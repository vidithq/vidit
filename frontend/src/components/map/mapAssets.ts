"use client";

import { addProtocol } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { useEffect, useState } from "react";

/** The self-hosted map files that `latest.json` names, as URLs MapLibre loads. */
export interface MapAssets {
  planet: string;
  sprite: string;
  naturalEarth: string;
  relief: string;
}

const BASE_URL = process.env.NEXT_PUBLIC_MAP_ASSETS_URL?.trim().replace(/\/+$/, "") || null;

// Mirrors backend services/map_files.py LATEST_FIELDS; change both.
const FIELDS = { planet: "planet", sprite: "sprite", naturalEarth: "natural_earth", relief: "relief" } as const;

function keyOf(latest: Record<string, unknown>, field: string): string {
  const entry = latest[field] as Record<string, unknown> | undefined;
  const key = entry?.key;
  if (typeof key !== "string" || !/^[\w@.-]+(\/[\w@.-]+)*$/.test(key) || key.split("/").includes("..")) {
    throw new Error(`latest.json: no valid ${field}.key`);
  }
  return key;
}

/** Resolves `latest.json` against the base URL it was read from. Throws on a missing or unsafe key. */
export function parseLatest(base: string, latest: unknown): MapAssets {
  if (!latest || typeof latest !== "object") throw new Error("latest.json: not an object");
  const at = (field: string) => `${base}/${keyOf(latest as Record<string, unknown>, field)}`;
  return {
    planet: `pmtiles://${at(FIELDS.planet)}`,
    sprite: at(FIELDS.sprite),
    naturalEarth: `pmtiles://${at(FIELDS.naturalEarth)}`,
    relief: `pmtiles://${at(FIELDS.relief)}`,
  };
}

/** The files `<base>/latest.json` names, or null when it cannot be read: the map then draws from
 *  the public sources rather than not at all. */
export async function fetchMapAssets(base: string): Promise<MapAssets | null> {
  try {
    const response = await fetch(`${base}/latest.json`, { cache: "no-cache" });
    if (!response.ok) throw new Error(`latest.json: ${response.status}`);
    return parseLatest(base, await response.json());
  } catch (error) {
    console.warn("Self-hosted map files unavailable; drawing from the public map sources.", error);
    return null;
  }
}

let loaded: Promise<MapAssets | null> | undefined;

function loadOnce(base: string): Promise<MapAssets | null> {
  loaded ??= fetchMapAssets(base).then((assets) => {
    if (assets) addProtocol("pmtiles", new Protocol().tile);
    return assets;
  });
  return loaded;
}

/** The self-hosted map files, read once per page load: null without `NEXT_PUBLIC_MAP_ASSETS_URL`
 *  or when they cannot be read, undefined while they load. */
export function useMapAssets(): MapAssets | null | undefined {
  const [assets, setAssets] = useState<MapAssets | null | undefined>(BASE_URL ? undefined : null);
  useEffect(() => {
    if (!BASE_URL) return;
    let live = true;
    void loadOnce(BASE_URL).then((next) => {
      if (live) setAssets(next);
    });
    return () => {
      live = false;
    };
  }, []);
  return assets;
}
