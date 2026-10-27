"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useControl } from "react-map-gl/maplibre";

import { MapControlButton } from "@/components/ui/MapControlButton";
import { PopoverPanel } from "@/components/ui/Popover";

/** A map control beside the zoom buttons that opens a `<PopoverPanel>` above it: the basemap
 *  picker, the go-to-coordinates field. `label` names the button and the panel. */
export function MapPopoverControl({
  label,
  icon,
  wide = false,
  children,
}: {
  label: string;
  icon: ReactNode;
  wide?: boolean;
  /** The panel's content, handed the close. */
  children: (close: (restoreFocus: boolean) => void) => ReactNode;
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
  const triggerId = useId();

  // By id rather than the ref: the content calls it, and a ref read there trips the compiler.
  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) document.getElementById(triggerId)?.focus();
  };

  return createPortal(
    <>
      <MapControlButton
        ref={triggerRef}
        id={triggerId}
        label={label}
        icon={icon}
        active={open}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <PopoverPanel id={panelId} label={label} anchorRef={triggerRef} onClose={close} wide={wide}>
          {children(close)}
        </PopoverPanel>
      )}
    </>,
    container,
  );
}
