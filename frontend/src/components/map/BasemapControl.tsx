"use client";

import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useControl } from "react-map-gl/maplibre";
import { Map as MapIcon } from "lucide-react";

import { FORM_LABEL } from "@/components/ui/form-styles";
import { MapControlButton } from "@/components/ui/MapControlButton";
import { PopoverPanel } from "@/components/ui/Popover";
import {
  SegmentedControl,
  type SegmentedControlOption,
} from "@/components/ui/SegmentedControl";

import type { BasemapPresetId } from "./basemap";
import type { BasemapSettings } from "./basemapSettings";

const PRESET_OPTIONS: SegmentedControlOption<BasemapPresetId>[] = [
  { value: "auto", label: "Auto" },
  { value: "vidit-dark", label: "Dark" },
  { value: "vidit-light", label: "Light" },
  { value: "streets", label: "Streets" },
  { value: "terrain", label: "Terrain" },
];

/** The basemap picker: a map control beside the zoom buttons that opens the basemap settings. */
export function BasemapControl({
  settings,
  onChange,
}: {
  settings: BasemapSettings;
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
        </PopoverPanel>
      )}
    </>,
    container,
  );
}
