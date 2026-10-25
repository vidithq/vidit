"use client";

import type { ReactNode } from "react";

import { DateTimeInput } from "@/components/ui/DateTimeInput";
import { FORM_LABEL, LABEL_TEXT } from "@/components/ui/form-styles";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { Card } from "@/components/ui/Card";
import { provenanceLabel } from "@/lib/events";
import { LockedHint } from "./LockedHint";
import { LockedUrl } from "./LockedUrl";

interface DetailsFieldsProps {
  eventDate: string;
  setEventDate: (v: string) => void;
  /** "HH:MM", UTC. */
  eventTime: string;
  setEventTime: (v: string) => void;
  /** A machine detection's provenance, the post it was imported from. Shown read-only (the one
   *  immutable field). */
  detectedFromUrl?: string | null;
  /** The row carries `requested_by`: the link reads "Requested from". */
  openedAsRequest?: boolean;
  /** The classification fields (conflict, tags), last in the card. */
  children?: ReactNode;
}

/** The Details card of every event form, in the order of the event page's Details card: when
 *  the event happened, the provenance link of an imported row, then the classification. */
export function DetailsFields({
  eventDate,
  setEventDate,
  eventTime,
  setEventTime,
  detectedFromUrl,
  openedAsRequest = false,
  children,
}: DetailsFieldsProps) {
  return (
    <Card>
      {/* One line at every width: two shrinking columns, in the side column and at 320px. */}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
        {/* Optional: an empty date reads as "Unknown". */}
        <div className="space-y-1.5">
          <span className="flex items-center gap-1">
            <label htmlFor="occurred_date" className={LABEL_TEXT}>
              Event date
            </label>
            <FieldHelp concept="occurred_date" />
          </span>
          <DateTimeInput
            id="occurred_date"
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <span className="flex items-center gap-1">
            <label htmlFor="occurred_time" className={LABEL_TEXT}>
              Event time
            </label>
            <FieldHelp concept="occurred_time" />
          </span>
          <DateTimeInput
            id="occurred_time"
            type="time"
            value={eventTime}
            onChange={(e) => setEventTime(e.target.value)}
          />
        </div>
      </div>

      {/* Always locked and populated, so always the link form. */}
      {detectedFromUrl && (
        <div className="space-y-1.5">
          <span className={FORM_LABEL}>
            {provenanceLabel(openedAsRequest)} <FieldHelp concept="detected_from" />
            <LockedHint>provenance, can&apos;t change</LockedHint>
          </span>
          <LockedUrl href={detectedFromUrl} />
        </div>
      )}
      {children}
    </Card>
  );
}
