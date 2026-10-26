import type { ComponentPropsWithRef, ReactNode } from "react";

import { cn } from "@/lib/cn";
import { ACCENT_SURFACE } from "./styles";

/**
 * A square icon button drawn like the MapLibre controls beside it (the zoom buttons): the same
 * 29px size, panel paint and border, so a control the app adds to the map reads as one of the
 * map's own. `active` paints it while what it opens is open.
 */
export function MapControlButton({
  label,
  icon,
  active = false,
  className,
  ...props
}: {
  /** The accessible name and the native tooltip, as on the MapLibre buttons. */
  label: string;
  icon: ReactNode;
  active?: boolean;
} & Omit<ComponentPropsWithRef<"button">, "children" | "aria-label" | "title">) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        // Important: MapLibre's `.maplibregl-ctrl button:hover` rule would paint a see-through 5% black.
        "size-[29px] rounded border border-neutral-700 !bg-neutral-900 text-neutral-300 shadow-[0_0_0_2px_rgba(0,0,0,0.1)] transition-colors hover:!bg-neutral-800 hover:text-neutral-100",
        className,
      )}
      {...props}
    >
      {/* The accent tint is translucent: on its own span it sits over the opaque panel paint,
          not over the map. */}
      <span
        className={cn("flex size-full items-center justify-center rounded-[3px]", active && ACCENT_SURFACE)}
      >
        {icon}
      </span>
    </button>
  );
}
