"use client";

import {
  FORM_INPUT,
  FORM_INPUT_LOCKED,
  FORM_LABEL,
} from "@/components/ui/form-styles";
import FieldHelp from "@/components/ui/FieldHelp";
import { FIELD_HELP } from "@/lib/fieldHelp";
import { LockedHint } from "./LockedHint";

interface DetailsFieldsProps {
  title: string;
  setTitle: (v: string) => void;
  sourceUrl: string;
  setSourceUrl: (v: string) => void;
  eventDate: string;
  setEventDate: (v: string) => void;
  /** Bounty-fulfilment mode: the source URL is locked to the bounty's. */
  lockedFromBounty: boolean;
}

/** The "Details" section — mirrors the detail page's Details block: the
 *  title, the date the event happened, and the original source. Coordinates
 *  live in the Location section; media in the Media section. */
export function DetailsFields({
  title,
  setTitle,
  sourceUrl,
  setSourceUrl,
  eventDate,
  setEventDate,
  lockedFromBounty,
}: DetailsFieldsProps) {
  return (
    <section className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-4">
      <header>
        <h2 className="text-sm font-medium text-neutral-200 inline-flex items-center gap-1.5">
          Details
          <FieldHelp text={FIELD_HELP.section_details} label="What goes in Details?" />
        </h2>
      </header>

      <div className="space-y-1.5">
        <label htmlFor="title" className={FORM_LABEL}>
          Title <FieldHelp text={FIELD_HELP.title} label="What makes a good title?" />
        </label>
        <input
          id="title"
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Strike on ammunition depot, Donetsk"
          className={FORM_INPUT}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label htmlFor="event_date" className={FORM_LABEL}>
            Event date <FieldHelp text={FIELD_HELP.event_date} label="What is the Event date?" />
          </label>
          <input
            id="event_date"
            type="date"
            required
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            className={FORM_INPUT}
          />
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
      </div>
    </section>
  );
}
