"use client";

import {
  FORM_INPUT,
  FORM_INPUT_LOCKED,
  FORM_LABEL,
} from "@/components/ui/form-styles";
import FieldHelp from "@/components/ui/FieldHelp";
import { FIELD_HELP } from "@/lib/fieldHelp";
import { LockedHint } from "./LockedHint";

/** Muted "optional" marker — required-by-default form convention. */
function OptionalHint() {
  return (
    <span className="ml-1 text-[10px] normal-case tracking-normal text-neutral-500">
      optional
    </span>
  );
}

interface DetailsFieldsProps {
  sourceUrl: string;
  setSourceUrl: (v: string) => void;
  eventDate: string;
  setEventDate: (v: string) => void;
  sourceDate: string;
  setSourceDate: (v: string) => void;
  /** Bounty-fulfilment mode: the source URL is locked to the bounty's. */
  lockedFromBounty: boolean;
  /** Geolocation requires the event date; on a bounty (an unfinished
   *  geolocation) it's optional. The source date is always optional. */
  eventDateRequired?: boolean;
}

/** The "Details" section — mirrors the detail page's Details block: when the
 *  event happened, when the source posted it, and the original source. Title
 *  leads the form; coordinates live in the Location section; media in Media. */
export function DetailsFields({
  sourceUrl,
  setSourceUrl,
  eventDate,
  setEventDate,
  sourceDate,
  setSourceDate,
  lockedFromBounty,
  eventDateRequired = true,
}: DetailsFieldsProps) {
  return (
    <section className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-4">
      <header>
        <h2 className="text-sm font-medium text-neutral-200 inline-flex items-center gap-1.5">
          Details
          <FieldHelp text={FIELD_HELP.section_details} label="What goes in Details?" />
        </h2>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label htmlFor="event_date" className={FORM_LABEL}>
            Event date <FieldHelp text={FIELD_HELP.event_date} label="What is the Event date?" />{" "}
            {!eventDateRequired && <OptionalHint />}
          </label>
          <input
            id="event_date"
            type="date"
            required={eventDateRequired}
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            className={FORM_INPUT}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="source_date" className={FORM_LABEL}>
            Source date{" "}
            <FieldHelp text={FIELD_HELP.source_date} label="What is the Source date?" />{" "}
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
          Source URL <FieldHelp text={FIELD_HELP.source_url} label="What is the Source URL?" />{" "}
          {lockedFromBounty && <LockedHint />}
        </label>
        <input
          id="source_url"
          type="url"
          required
          readOnly={lockedFromBounty}
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://t.me/channel/12345"
          className={lockedFromBounty ? FORM_INPUT_LOCKED : FORM_INPUT}
        />
      </div>
    </section>
  );
}
