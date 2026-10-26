"use client";

import { useId, useRef, useState } from "react";
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

const PRESET_OPTIONS: SegmentedControlOption<BasemapPresetId>[] = [
  { value: "auto", label: "Auto" },
  { value: "vidit-dark", label: "Dark" },
  { value: "vidit-light", label: "Light" },
  { value: "streets", label: "Streets" },
  { value: "terrain", label: "Terrain" },
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
  description: string;
}

const LAYER_TOGGLES: SwitchSetting[] = [
  { key: "regionBorders", label: "Region borders", description: "Borders between a country's regions." },
  { key: "roads", label: "Roads", description: "Roads, railways and their names." },
  { key: "buildings", label: "Buildings", description: "Building footprints, from zoom 13." },
  {
    key: "disputedDashed",
    label: "Dashed disputed borders",
    description: "Off draws a disputed border solid, like a settled one.",
  },
];

/** The basemap picker: a map control beside the zoom buttons that opens the basemap settings. The
 *  detail settings show only on a preset they apply to (the Vidit styles). */
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
          {/* Scrolls on a short viewport, where every setting cannot fit above the button. */}
          <div className="max-h-[calc(100dvh-5rem)] space-y-2 overflow-y-auto">
            <div className="space-y-1.5">
              <p className={FORM_LABEL}>Basemap</p>
              <SegmentedControl
                aria-label="Basemap"
                options={PRESET_OPTIONS}
                value={settings.preset}
                onChange={(preset) => onChange({ preset })}
              />
              <p className="text-xs text-neutral-500">Auto follows the theme.</p>
            </div>
            {adjustable ? (
              <>
                <div className="space-y-3 border-t border-neutral-700 pt-3">
                  <p className={FORM_LABEL}>Labels</p>
                  <ChoiceRow
                    label="Label language"
                    description="Local writes each place in its own script."
                    options={LANGUAGE_OPTIONS}
                    value={settings.language}
                    onChange={(language) => onChange({ language })}
                  />
                  <ChoiceRow
                    label="Label density"
                    description="Sparse names only countries and capitals when zoomed out."
                    options={DENSITY_OPTIONS}
                    value={settings.density}
                    onChange={(density) => onChange({ density })}
                  />
                </div>
                <div className="space-y-3 border-t border-neutral-700 pt-3">
                  <p className={FORM_LABEL}>Layers</p>
                  {LAYER_TOGGLES.map((toggle) => (
                    <ToggleRow
                      key={toggle.key}
                      label={toggle.label}
                      description={toggle.description}
                      on={settings[toggle.key]}
                      onToggle={() => onChange({ [toggle.key]: !settings[toggle.key] })}
                    />
                  ))}
                </div>
              </>
            ) : (
              <p className="border-t border-neutral-700 pt-2 text-xs text-neutral-500">
                Labels and layers adjust on the Dark and Light basemaps.
              </p>
            )}
          </div>
        </PopoverPanel>
      )}
    </>,
    container,
  );
}
