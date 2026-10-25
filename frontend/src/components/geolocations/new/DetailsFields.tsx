"use client";

import { DateTimeInput } from "@/components/ui/DateTimeInput";
import { FORM_LABEL } from "@/components/ui/form-styles";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
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
}

/** The "Details" section, mirroring the detail page's Details block: when the event happened,
 *  and the provenance link of an imported row. Shared by every event form. */
export function DetailsFields({
  eventDate,
  setEventDate,
  eventTime,
  setEventTime,
  detectedFromUrl,
  openedAsRequest = false,
}: DetailsFieldsProps) {
  return (
    <Card as="section">
      <SectionHeading title="Details" concept="section_details" />

      {/* Two columns once the box holds both, whichever column the card sits in. */}
      <div className="@container">
        <div className="grid grid-cols-1 @md:grid-cols-2 gap-4">
          {/* Optional: an empty date reads as "Unknown". */}
          <div className="space-y-1.5">
            <label htmlFor="occurred_date" className={FORM_LABEL}>
              Event date <FieldHelp concept="occurred_date" />
            </label>
            <DateTimeInput
              id="occurred_date"
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="occurred_time" className={FORM_LABEL}>
              Event time <FieldHelp concept="occurred_time" />
            </label>
            <DateTimeInput
              id="occurred_time"
              type="time"
              value={eventTime}
              onChange={(e) => setEventTime(e.target.value)}
            />
          </div>
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
    </Card>
  );
}
