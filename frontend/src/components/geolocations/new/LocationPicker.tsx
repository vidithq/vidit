"use client";

import type { TweetImportCoord } from "@/types";
import {
  FORM_INPUT,
  FORM_INPUT_LOCKED,
  FORM_LABEL,
} from "@/components/ui/form-styles";
import FieldHelp from "@/components/ui/FieldHelp";
import { FIELD_HELP } from "@/lib/fieldHelp";
import { LockedHint } from "./LockedHint";

interface LocationPickerProps {
  title: string;
  setTitle: (v: string) => void;
  lat: string;
  setLat: (v: string) => void;
  lng: string;
  setLng: (v: string) => void;
  sourceUrl: string;
  setSourceUrl: (v: string) => void;
  eventDate: string;
  setEventDate: (v: string) => void;
  /** Bounty-fulfilment mode: the source URL is locked to the bounty's. */
  lockedFromBounty: boolean;
  /** Leftover coordinates from a tweet import, offered as swap chips. */
  extraCoordCandidates: TweetImportCoord[];
  onSwapCandidate: (candidate: TweetImportCoord) => void;
}

/** The "Where & when" section: title, coordinates (+ swap chips from a
 *  tweet import), original source, and the date the event happened. */
export function LocationPicker({
  title,
  setTitle,
  lat,
  setLat,
  lng,
  setLng,
  sourceUrl,
  setSourceUrl,
  eventDate,
  setEventDate,
  lockedFromBounty,
  extraCoordCandidates,
  onSwapCandidate,
}: LocationPickerProps) {
  return (
    <section className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-4">
      <header className="space-y-1">
        <h2 className="text-sm font-medium text-neutral-200">
          Where &amp; when
        </h2>
        <p className="text-xs text-neutral-500">
          Title, coordinates, original source, and the date the event
          happened.
        </p>
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

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label htmlFor="lat" className={FORM_LABEL}>
            Latitude
          </label>
          <input
            id="lat"
            type="text"
            required
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            placeholder="48.015883"
            className={`${FORM_INPUT} font-mono`}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="lng" className={FORM_LABEL}>
            Longitude
          </label>
          <input
            id="lng"
            type="text"
            required
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            placeholder="37.802411"
            className={`${FORM_INPUT} font-mono`}
          />
        </div>
      </div>
      {extraCoordCandidates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-neutral-500">Also detected:</span>
          {extraCoordCandidates.map((c, i) => (
            <button
              key={`${c.lat}-${c.lng}-${i}`}
              type="button"
              onClick={() => onSwapCandidate(c)}
              className="font-mono px-2 py-0.5 rounded-md bg-neutral-800 text-orange-400 hover:bg-neutral-700 transition-colors"
            >
              {c.lat.toFixed(5)}, {c.lng.toFixed(5)} ↺
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
      </div>
    </section>
  );
}
