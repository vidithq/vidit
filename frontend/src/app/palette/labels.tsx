"use client";

import { CharCounter } from "@/components/ui/CharCounter";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { IncompleteFormAnnouncer } from "@/components/ui/IncompleteFormAnnouncer";
import {
  FORM_INVALID_LABEL,
  FORM_LABEL,
  FORM_LABEL_COMPACT,
  LABEL_TEXT,
} from "@/components/ui/form-styles";
import { EVENT_FIELDS } from "@/lib/events";
import { SOURCE_FIELDS } from "@/lib/sources";
import { type PaletteCategory } from "./shared";

export const LABELS: PaletteCategory = {
  id: "labels",
  title: "Labels and help",
  entries: [
    {
      name: "FORM_LABEL / FORM_LABEL_COMPACT / LABEL_TEXT / FORM_INVALID_LABEL",
      demo: (
        <div className="space-y-2">
          <label className={FORM_LABEL}>FORM_LABEL</label>
          <label className={FORM_LABEL_COMPACT}>FORM_LABEL_COMPACT</label>
          <span className={LABEL_TEXT}>LABEL_TEXT</span>
          <label className={`${FORM_LABEL} ${FORM_INVALID_LABEL}`}>FORM_INVALID_LABEL</label>
        </div>
      ),
    },
    {
      name: "FieldLabel",
      demo: (
        <div className="w-full max-w-sm space-y-3">
          <FieldLabel {...EVENT_FIELDS.occurred_date} htmlFor="palette-field-label" />
          <FieldLabel {...EVENT_FIELDS.coordinates} invalid />
          <FieldLabel {...SOURCE_FIELDS.title} trailing={<CharCounter length={12} max={200} />} />
        </div>
      ),
    },
    {
      name: "CharCounter",
      demo: (
        <>
          <CharCounter length={120} max={500} />
          <CharCounter length={512} max={500} />
        </>
      ),
    },
    {
      name: "FieldHelp",
      demo: (
        <span className="inline-flex items-center gap-3 text-sm text-neutral-300">
          <span className="inline-flex items-center gap-1">
            Coordinates <FieldHelp concept="coordinates" />
          </span>
          <span className="inline-flex items-center gap-1">
            Relief <FieldHelp concept="map_relief" />
          </span>
        </span>
      ),
    },
    {
      name: "IncompleteFormAnnouncer",
      demo: (
        <IncompleteFormAnnouncer missing={["Coordinates", "Conflict", "Proof"]} attempt={1} />
      ),
    },
  ],
};
