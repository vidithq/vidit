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
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { LockedHint } from "./LockedHint";

interface DetailsFieldsProps {
  sourceUrl: string;
  /** Omit when `sourceUrlLocked` — a read-only field never calls it. */
  setSourceUrl?: (v: string) => void;
  eventDate: string;
  setEventDate: (v: string) => void;
  /** Optional event time-of-day ("HH:MM", UTC). */
  eventTime: string;
  setEventTime: (v: string) => void;
  /** When the source posted the media: a datetime-local value
   *  ("YYYY-MM-DDTHH:MM", UTC). Required: a post always has a time. */
  sourcePostedAt: string;
  setSourcePostedAt: (v: string) => void;
  /** Render the source URL read-only — it's inherited from the bounty on a
   *  fulfilment (shows a "from bounty" hint). The detection edit form leaves it
   *  editable (`false`). */
  sourceUrlLocked: boolean;
  /** A machine detection's provenance — the post it was imported from. Shown
   *  read-only inside this block (it's the one immutable field) when provided;
   *  the submit form omits it. */
  detectedFromUrl?: string | null;
  /** Geolocation requires the event date; on a bounty (an unfinished
   *  geolocation) it's optional. Event time is always optional; the source post
   *  time is always required. */
  eventDateRequired?: boolean;
  /** Flag the event-date / source-time / source-URL inputs as missing. */
  eventDateInvalid?: boolean;
  sourcePostedAtInvalid?: boolean;
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
  eventTime,
  setEventTime,
  sourcePostedAt,
  setSourcePostedAt,
  sourceUrlLocked,
  detectedFromUrl,
  eventDateRequired = true,
  eventDateInvalid = false,
  sourcePostedAtInvalid = false,
  sourceUrlInvalid = false,
}: DetailsFieldsProps) {
  return (
    <Card as="section">
      <SectionHeading title="Details" concept="section_details" />

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
            className={`${FORM_INPUT}${eventDate ? " has-value" : ""}${eventDateInvalid ? ` ${FORM_INVALID_FIELD}` : ""}`}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="event_time" className={FORM_LABEL}>
            Event time <FieldHelp concept="event_time" /> <OptionalHint />
          </label>
          <input
            id="event_time"
            type="time"
            value={eventTime}
            onChange={(e) => setEventTime(e.target.value)}
            className={`${FORM_INPUT}${eventTime ? " has-value" : ""}`}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="source_posted_at" className={FORM_LABEL}>
          Source posted (UTC) <FieldHelp concept="source_posted_at" />
        </label>
        <input
          id="source_posted_at"
          type="datetime-local"
          required
          value={sourcePostedAt}
          onChange={(e) => setSourcePostedAt(e.target.value)}
          className={`${FORM_INPUT}${sourcePostedAt ? " has-value" : ""}${sourcePostedAtInvalid ? ` ${FORM_INVALID_FIELD}` : ""}`}
        />
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
    </Card>
  );
}
