"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useControl } from "react-map-gl/maplibre";
import { Map as MapIcon } from "lucide-react";

import { ChoiceRow } from "@/components/ui/ChoiceRow";
import { FORM_LABEL } from "@/components/ui/form-styles";
import { MapControlButton } from "@/components/ui/MapControlButton";
import { PopoverPanel } from "@/components/ui/Popover";
import {
  SegmentedControl,
  type SegmentedControlOption,
} from "@/components/ui/SegmentedControl";
import { ToggleRow } from "@/components/ui/ToggleRow";

import type { BasemapPresetId, LabelDensity, LabelLanguage } from "./basemap";
import type { BasemapSettings } from "./basemapSettings";

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
}

const LAYER_TOGGLES: SwitchSetting[] = [
  { key: "regionBorders", label: "Region borders" },
  { key: "roads", label: "Roads" },
  { key: "buildings", label: "Buildings" },
  { key: "militaryAndAirports", label: "Military areas and airports" },
  { key: "relief", label: "Relief" },
  { key: "disputedDashed", label: "Dashed disputed borders" },
];

const OVERLAY_TOGGLES: SwitchSetting[] = [
  { key: "grid", label: "Coordinate grid" },
  { key: "dailyImagery", label: "Daily satellite imagery" },
  { key: "fires", label: "Fire detections" },
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
  onChange,
}: {
  settings: BasemapSettings;
  /** Whether the current preset takes the detail settings. */
  adjustable: boolean;
  onChange: (patch: Partial<BasemapSettings>) => void;
}) {
  // MapLibre places a control's element in its corner; the button renders into it.
  const [container] = useState(() => {
    const element = document.createElement("div");
    element.className = "maplibregl-ctrl";
    return element;
  });
  useControl(
    () => ({ onAdd: () => container, onRemove: () => container.remove() }),
    { position: "bottom-left" },
  );

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const switches = (toggles: SwitchSetting[]) =>
    toggles.map((toggle) => (
      <ToggleRow
        key={toggle.key}
        label={toggle.label}
        variant="setting"
        on={settings[toggle.key]}
        onToggle={() => onChange({ [toggle.key]: !settings[toggle.key] })}
      />
    ));

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  return createPortal(
    <>
      <MapControlButton
        ref={triggerRef}
        label="Basemap"
        icon={<MapIcon size={15} />}
        active={open}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <PopoverPanel id={panelId} label="Basemap" anchorRef={triggerRef} onClose={close} wide>
          {/* Stops short of the map's top-left filter overlay and scrolls when the settings do not fit. */}
          <div className="max-h-[calc(100dvh-12rem)] space-y-2 overflow-y-auto">
            <div className="space-y-1.5">
              <p className={FORM_LABEL}>Basemap</p>
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
                    options={LANGUAGE_OPTIONS}
                    value={settings.language}
                    onChange={(language) => onChange({ language })}
                  />
                  <ChoiceRow
                    label="Label density"
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
        </PopoverPanel>
      )}
    </>,
    container,
  );
}
