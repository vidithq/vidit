"use client";

import type { ReactNode } from "react";
import { Map as MapIcon } from "lucide-react";

import { ChoiceRow } from "@/components/ui/ChoiceRow";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { FORM_LABEL } from "@/components/ui/form-styles";
import {
  SegmentedControl,
  type SegmentedControlOption,
} from "@/components/ui/SegmentedControl";
import { ToggleRow } from "@/components/ui/ToggleRow";
import type { Concept } from "@/lib/fieldHelp";

import type { BasemapPresetId, LabelDensity, LabelLanguage } from "./basemap";
import type { BasemapSettings } from "./basemapSettings";
import { MapPopoverControl } from "./MapPopoverControl";

// Two rows, since six options overflow the panel: the Vidit styles, which take the label and layer
// settings, then the third-party ones, drawn as published.
const PRESET_ROWS: { label: string; options: SegmentedControlOption<BasemapPresetId>[] }[] = [
  {
    label: "Vidit basemaps",
    options: [
      { value: "auto", label: "Auto" },
      { value: "vidit-dark", label: "Dark" },
      { value: "vidit-light", label: "Light" },
    ],
  },
  {
    label: "Other basemaps",
    options: [
      { value: "streets", label: "Streets" },
      { value: "terrain", label: "Terrain" },
      { value: "satellite", label: "Satellite 2016" },
    ],
  },
];

// The `?` beside the heading explains the preset on show, since a `?` cannot sit in a segment.
const PRESET_HELP: Record<BasemapPresetId, Concept> = {
  auto: "basemap_auto",
  "vidit-dark": "basemap_dark",
  "vidit-light": "basemap_light",
  streets: "basemap_streets",
  terrain: "basemap_terrain",
  satellite: "basemap_satellite",
};

const LANGUAGE_OPTIONS: SegmentedControlOption<LabelLanguage>[] = [
  { value: "latin", label: "Latin" },
  { value: "local", label: "Local" },
  { value: "both", label: "Both" },
];

const DENSITY_OPTIONS: SegmentedControlOption<LabelDensity>[] = [
  { value: "sparse", label: "Sparse" },
  { value: "normal", label: "Normal" },
];

type SwitchKey = {
  [K in keyof BasemapSettings]: BasemapSettings[K] extends boolean ? K : never;
}[keyof BasemapSettings];

interface SwitchSetting {
  key: SwitchKey;
  label: string;
  concept?: Concept;
}

const LAYER_TOGGLES: SwitchSetting[] = [
  { key: "regionBorders", label: "Region borders", concept: "map_region_borders" },
  { key: "roads", label: "Roads", concept: "map_roads" },
  { key: "buildings", label: "Buildings", concept: "map_buildings" },
  { key: "militaryAndAirports", label: "Military areas and airports", concept: "map_military_airports" },
  { key: "relief", label: "Relief", concept: "map_relief" },
  { key: "disputedDashed", label: "Dashed disputed borders", concept: "map_disputed_borders" },
];

// The grid has no `?`: it draws from no outside source, and its label says what it shows.
const OVERLAY_TOGGLES: SwitchSetting[] = [
  { key: "grid", label: "Coordinate grid" },
  { key: "dailyImagery", label: "Daily satellite imagery", concept: "map_daily_imagery" },
  { key: "fires", label: "Fire detections", concept: "map_fire_detections" },
];

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3 border-t border-neutral-700 pt-3">
      <p className={FORM_LABEL}>{title}</p>
      {children}
    </div>
  );
}

/** The basemap picker: a map control beside the zoom buttons that opens the basemap settings. The
 *  label and layer settings show only on a preset they apply to (the Vidit styles); the overlays
 *  show on every preset. */
export function BasemapControl({
  settings,
  adjustable,
  overlaysLoading = false,
  onChange,
}: {
  settings: BasemapSettings;
  /** Whether the current preset takes the detail settings. */
  adjustable: boolean;
  /** Whether the daily imagery or the fire detections are still loading (`<SatelliteOverlays>`). */
  overlaysLoading?: boolean;
  onChange: (patch: Partial<BasemapSettings>) => void;
}) {
  const switches = (toggles: SwitchSetting[]) =>
    toggles.map((toggle) => (
      <ToggleRow
        key={toggle.key}
        label={toggle.label}
        concept={toggle.concept}
        variant="setting"
        on={settings[toggle.key]}
        onToggle={() => onChange({ [toggle.key]: !settings[toggle.key] })}
      />
    ));

  return (
    <MapPopoverControl
      label="Basemap"
      icon={<MapIcon size={15} />}
      wide
      busy={overlaysLoading ? "Loading satellite overlays" : undefined}
    >
      {/* Stops short of the map's top-left filter overlay and scrolls when the settings do not fit. */}
      {() => (
        <div className="max-h-[calc(100dvh-12rem)] space-y-2 overflow-y-auto">
          <div className="space-y-1.5">
            <FieldLabel label="Basemap" concept={PRESET_HELP[settings.preset]} />
            {PRESET_ROWS.map((row) => (
              <SegmentedControl
                key={row.label}
                aria-label={row.label}
                options={row.options}
                value={settings.preset}
                onChange={(preset) => onChange({ preset })}
                fullWidth
              />
            ))}
          </div>
          {adjustable ? (
            <>
              <SettingsGroup title="Labels">
                <ChoiceRow
                  label="Label language"
                  concept="map_label_language"
                  options={LANGUAGE_OPTIONS}
                  value={settings.language}
                  onChange={(language) => onChange({ language })}
                />
                <ChoiceRow
                  label="Label density"
                  concept="map_label_density"
                  options={DENSITY_OPTIONS}
                  value={settings.density}
                  onChange={(density) => onChange({ density })}
                />
              </SettingsGroup>
              <SettingsGroup title="Layers">{switches(LAYER_TOGGLES)}</SettingsGroup>
            </>
          ) : (
            <p className="border-t border-neutral-700 pt-2 text-xs text-neutral-500">
              Labels and layers adjust on the Dark and Light basemaps.
            </p>
          )}
          <SettingsGroup title="Overlays">{switches(OVERLAY_TOGGLES)}</SettingsGroup>
        </div>
      )}
    </MapPopoverControl>
  );
}
