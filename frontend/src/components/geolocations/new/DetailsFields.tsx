"use client";

import { Lock } from "lucide-react";

import {
  FORM_INPUT,
  FORM_INPUT_LOCKED,
  FORM_INVALID_FIELD,
  FORM_LABEL,
} from "@/components/ui/form-styles";
import FieldHelp from "@/components/ui/FieldHelp";
import { OptionalHint } from "@/components/ui/OptionalHint";
import { LockedHint } from "./LockedHint";

interface DetailsFieldsProps {
  sourceUrl: string;
  /** Omit when `sourceUrlLocked` — a read-only field never calls it. */
  setSourceUrl?: (v: string) => void;
  eventDate: string;
  setEventDate: (v: string) => void;
  sourceDate: string;
  setSourceDate: (v: string) => void;
  /** Render the source URL read-only — it's inherited from the bounty on a
   *  fulfilment (shows a "from bounty" hint). The detection edit form leaves it
   *  editable (`false`). */
  sourceUrlLocked: boolean;
  /** A machine detection's provenance — the post it was imported from. Shown
   *  read-only inside this block (it's the one immutable field) when provided;
   *  the submit form omits it. */
  detectedFromUrl?: string | null;
  /** Geolocation requires the event date; on a bounty (an unfinished
   *  geolocation) it's optional. The source date is always optional. */
  eventDateRequired?: boolean;
  /** Flag the event-date / source-URL inputs as missing required fields. */
  eventDateInvalid?: boolean;
  sourceUrlInvalid?: boolean;
}

/** The "Details" section — mirrors the detail page's Details block: when the
 *  event happened, when the source posted it, and the original source. Title
 *  leads the form; coordinates live in the Location section; media in Media.
 *  Shared by the submit form and the detection edit form. */
export function DetailsFields({
  sourceUrl,
  setSourceUrl,
  eventDate,
  setEventDate,
  sourceDate,
  setSourceDate,
  sourceUrlLocked,
  detectedFromUrl,
  eventDateRequired = true,
  eventDateInvalid = false,
  sourceUrlInvalid = false,
}: DetailsFieldsProps) {
  return (
    <section className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-4">
      <header>
        <h2 className="text-sm font-medium text-neutral-200 inline-flex items-center gap-1.5">
          Details
          <FieldHelp concept="section_details" />
        </h2>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label htmlFor="event_date" className={FORM_LABEL}>
            Event date <FieldHelp concept="event_date" />{" "}
            {!eventDateRequired && <OptionalHint />}
          </label>
          <input
            id="event_date"
            type="date"
            required={eventDateRequired}
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            className={`${FORM_INPUT}${eventDateInvalid ? ` ${FORM_INVALID_FIELD}` : ""}`}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="source_date" className={FORM_LABEL}>
            Source date{" "}
            <FieldHelp concept="source_date" />{" "}
            <OptionalHint />
          </label>
          <input
            id="source_date"
            type="date"
            value={sourceDate}
            onChange={(e) => setSourceDate(e.target.value)}
            className={FORM_INPUT}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="source_url" className={FORM_LABEL}>
          Source URL <FieldHelp concept="source_url" />{" "}
          {sourceUrlLocked && <LockedHint />}
        </label>
        <input
          id="source_url"
          type="url"
          required
          readOnly={sourceUrlLocked}
          value={sourceUrl}
          onChange={(e) => setSourceUrl?.(e.target.value)}
          placeholder="https://t.me/channel/12345"
          className={`${sourceUrlLocked ? FORM_INPUT_LOCKED : FORM_INPUT}${
            sourceUrlInvalid ? ` ${FORM_INVALID_FIELD}` : ""
          }`}
        />
      </div>

      {detectedFromUrl && (
        <div className="space-y-1.5">
          <label htmlFor="detected_from_url" className={FORM_LABEL}>
            Detected from <FieldHelp concept="detected_from" />
            <span className="inline-flex items-center gap-1 ml-1.5 normal-case tracking-normal text-[10px] text-neutral-500">
              <Lock size={10} />
              provenance, can&apos;t change
            </span>
          </label>
          <input
            id="detected_from_url"
            type="url"
            readOnly
            value={detectedFromUrl}
            className={FORM_INPUT_LOCKED}
          />
        </div>
      )}
    </section>
  );
}
