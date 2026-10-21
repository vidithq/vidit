"use client";

import { useId } from "react";

import { CharCounter } from "@/components/ui/CharCounter";
import { DateTimeInput } from "@/components/ui/DateTimeInput";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { FORM_LABEL } from "@/components/ui/form-styles";
import {
  IMAGERY_PROVIDER_LABELS,
  OBSERVATION_EFFECT_LABELS,
  SITE_NOTE_MAX_LEN,
  labelOptions,
  type ImageryProvider,
  type ObservationDraft,
  type ObservationEffect,
} from "@/lib/sites";

/** The imagery fields of an observation: provider, capture date, the image URL (required for
 *  Other), what the imagery shows, and a note. Shared by the site create form and the
 *  observation form. */
export function ObservationFields({
  draft,
  onChange,
  today,
}: {
  draft: ObservationDraft;
  onChange: (next: ObservationDraft) => void;
  today: string;
}) {
  const ids = {
    provider: useId(),
    capturedOn: useId(),
    url: useId(),
    effect: useId(),
    note: useId(),
  };
  const set = <K extends keyof ObservationDraft>(key: K, value: ObservationDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const urlRequired = draft.provider === "other";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={ids.provider} className={FORM_LABEL}>
            Imagery provider
          </label>
          <Select
            id={ids.provider}
            value={draft.provider}
            onChange={(e) => set("provider", e.target.value as ImageryProvider | "")}
          >
            <option value="">Pick a provider</option>
            {labelOptions(IMAGERY_PROVIDER_LABELS).map((o) => (
              <option key={o.value} value={o.value}>
                {o.value === "other" ? "Other (URL required)" : o.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={ids.capturedOn} className={FORM_LABEL}>
            Capture date
          </label>
          <DateTimeInput
            id={ids.capturedOn}
            type="date"
            max={today}
            value={draft.capturedOn}
            onChange={(e) => set("capturedOn", e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={ids.url} className={FORM_LABEL}>
          Public URL of the image {urlRequired ? "(required)" : "(optional for a listed provider)"}
        </label>
        <Input
          id={ids.url}
          type="url"
          inputMode="url"
          placeholder="https://"
          value={draft.url}
          onChange={(e) => set("url", e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <span className="flex items-center gap-1">
          <label htmlFor={ids.effect} className={FORM_LABEL}>
            What the imagery shows
          </label>
          <FieldHelp concept="observation_effect" size={12} />
        </span>
        <Select
          id={ids.effect}
          value={draft.effect}
          onChange={(e) => set("effect", e.target.value as ObservationEffect)}
        >
          {labelOptions(OBSERVATION_EFFECT_LABELS).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <span className="flex items-center justify-between gap-2">
          <label htmlFor={ids.note} className={FORM_LABEL}>
            Note (optional)
          </label>
          <CharCounter length={draft.note.length} max={SITE_NOTE_MAX_LEN} />
        </span>
        <Textarea
          id={ids.note}
          rows={3}
          value={draft.note}
          invalid={draft.note.length > SITE_NOTE_MAX_LEN}
          onChange={(e) => set("note", e.target.value)}
          placeholder="What you see on the image, in plain words."
        />
      </div>

      <p className="flex items-start gap-1.5 text-xs text-neutral-500">
        <FieldHelp concept="site_observation" size={12} />
        Vidit is never the first to publish an image. Pick a public provider with its capture
        date, or give the public URL where the image already appears.
      </p>
    </div>
  );
}
