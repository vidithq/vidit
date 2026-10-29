"use client";

import { Copy, MapPin } from "lucide-react";

import { Button } from "@/components/ui/Button";
import {
  ACCENT_RAMP,
  ACCENT_SURFACE,
  ARMED_RING,
  CHART_NEUTRAL,
  CHART_TAIL,
  META_LINE,
  TAPPABLE_HOVER,
  TEXT_LINK,
  TOOLTIP_SURFACE,
  WARNING_CALLOUT,
} from "@/components/ui/styles";
import { Variant, type PaletteCategory } from "./shared";

export const TOKENS: PaletteCategory = {
  id: "tokens",
  title: "Tokens",
  entries: [
    {
      entry: "ACCENT_SURFACE",
      demo: (
        <span className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${ACCENT_SURFACE}`}>
          Active
        </span>
      ),
    },
    {
      entry: "TEXT_LINK",
      demo: (
        <a href="#" className={TEXT_LINK} onClick={(e) => e.preventDefault()}>
          A text link
        </a>
      ),
    },
    {
      entry: "META_LINE",
      demo: (
        <span className={META_LINE}>
          <MapPin size={11} aria-hidden />
          Organization · 4 members
        </span>
      ),
    },
    {
      entry: "TAPPABLE_HOVER",
      demo: (
        <>
          <Variant label="row">
            <div
              className={`rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-300 ${TAPPABLE_HOVER}`}
            >
              Hover me
            </div>
          </Variant>
          <Variant label="section, group-hover title">
            <div
              className={`group block rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 ${TAPPABLE_HOVER}`}
            >
              <h4 className="text-sm font-medium text-neutral-100 transition-colors group-hover:text-orange-400">
                A whole clickable section
              </h4>
            </div>
          </Variant>
        </>
      ),
    },
    {
      entry: "ARMED_RING",
      demo: (
        <>
          <Button action="geolocate" variant="primary" className={ARMED_RING}>
            Confirm
          </Button>
          <Button
            icon
            variant="ghost"
            className={ARMED_RING}
            aria-label="Copy coordinates"
            title="Copy coordinates"
          >
            <Copy size={15} />
          </Button>
        </>
      ),
    },
    {
      entry: "WARNING_CALLOUT",
      demo: (
        <div className={`rounded-md px-4 py-3 text-sm ${WARNING_CALLOUT}`}>
          Heads up, check this before submitting.
        </div>
      ),
    },
  ],
};
