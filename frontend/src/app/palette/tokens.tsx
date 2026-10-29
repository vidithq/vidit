"use client";

import { Copy, MapPin } from "lucide-react";

import { Button } from "@/components/ui/Button";
import {
  ACCENT_SURFACE,
  ACCENT_RAMP,
  ARMED_RING,
  CHART_NEUTRAL,
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
      entry: "ACCENT_SURFACE", tier: "low",
      demo: (
        <span className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${ACCENT_SURFACE}`}>
          Active
        </span>
      ),
    },
    {
      entry: "TEXT_LINK", tier: "low",
      demo: (
        <a href="#" className={TEXT_LINK} onClick={(e) => e.preventDefault()}>
          A text link
        </a>
      ),
    },
    {
      entry: "META_LINE", tier: "low",
      demo: (
        <span className={META_LINE}>
          <MapPin size={11} aria-hidden />
          Organization · 4 members
        </span>
      ),
    },
    {
      entry: "TAPPABLE_HOVER", tier: "low",
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
      entry: "ARMED_RING", tier: "high",
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
      entry: "WARNING_CALLOUT", tier: "low",
      demo: (
        <div className={`rounded-md px-4 py-3 text-sm ${WARNING_CALLOUT}`}>
          Heads up, check this before submitting.
        </div>
      ),
    },
    {
      entry: "ACCENT_RAMP / CHART_NEUTRAL", tier: "low",
      demo: (
        <>
          <Variant label="ACCENT_RAMP">
            <span className="flex gap-1">
              {ACCENT_RAMP.map((paint) => (
                <span key={paint} className={`size-5 rounded-xs ${paint}`} />
              ))}
            </span>
          </Variant>
          <Variant label="CHART_NEUTRAL">
            <span className={`block size-5 rounded-xs ${CHART_NEUTRAL}`} />
          </Variant>
        </>
      ),
    },
    {
      entry: "TOOLTIP_SURFACE", tier: "low",
      demo: <span className={`inline-block rounded-md px-2 py-1 text-xs ${TOOLTIP_SURFACE}`}>maya</span>,
    },
  ],
};
