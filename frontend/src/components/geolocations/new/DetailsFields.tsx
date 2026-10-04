"use client";

import { useState } from "react";

import type { ArchivedLink } from "@/types";
import {
  ArchiveAdornment,
  ArchiveSnapshotField,
  DETECTED_FROM_DESCRIPTION,
  mirrorDescription,
  PRIMARY_SOURCE_DESCRIPTION,
} from "@/components/ui/ArchivedCopies";
import { safeHostname } from "@/lib/format";
import { DateTimeInput } from "@/components/ui/DateTimeInput";
import { FORM_INVALID_LABEL, FORM_LABEL } from "@/components/ui/form-styles";
import { Input } from "@/components/ui/Input";
import { LinkListInput } from "@/components/ui/LinkListInput";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Switch } from "@/components/ui/Switch";
import { MAX_SECONDARY_SOURCE_LINKS } from "@/lib/events";
import { LockedHint } from "./LockedHint";
import { LockedUrl } from "./LockedUrl";

interface DetailsFieldsProps {
  sourceUrl: string;
  /** Omit when `sourceUrlLocked`. */
  setSourceUrl?: (v: string) => void;
  /** Posted as `source_snapshot_url`. */
  sourceSnapshotUrl: string;
  setSourceSnapshotUrl: (v: string) => void;
  /** The copy the event already carries; null on a fresh submit. */
  archivedSource?: ArchivedLink | null;
  /** Optional mirrors. Editable on every path (the geolocate transition
   *  replaces the list), so there is no locked mode. */
  secondarySourceUrls: string[];
  setSecondarySourceUrls: (v: string[]) => void;
  /** One paste per mirror, index-aligned with the list above, posted as
   *  `secondary_snapshot_urls`. */
  secondarySnapshotUrls: string[];
  setSecondarySnapshotUrls: (v: string[]) => void;
  /** Keyed by link (`archivedCopies`), not position, because rows are edited. */
  archivedCopies?: ReadonlyMap<string, ArchivedLink>;
  eventDate: string;
  setEventDate: (v: string) => void;
  /** "HH:MM", UTC. */
  eventTime: string;
  setEventTime: (v: string) => void;
  /** datetime-local value ("YYYY-MM-DDTHH:MM", UTC). */
  sourcePostedAt: string;
  setSourcePostedAt: (v: string) => void;
  /** False on the request edit (the bot opens requests whose source date it
   *  could not read). Marks the input `required` for the a11y tree. */
  sourcePostedAtRequired?: boolean;
  isGraphic: boolean;
  setIsGraphic: (v: boolean) => void;
  /** The loaded event already carries the flag. It ratchets on the backend, so
   *  the switch refuses the toggle instead of offering a change the geolocate
   *  write would discard. */
  graphicLocked?: boolean;
  /** Read-only, inherited from the request on a fulfilment ("from request"
   *  hint). */
  sourceUrlLocked?: boolean;
  /** A machine detection's provenance, the post it was imported from. Shown
   *  read-only (the one immutable field). */
  detectedFromUrl?: string | null;
  /** Posted as `detected_from_snapshot_url`. Only the published-row edit passes
   *  the pair; without the setter the locked field renders bare. */
  detectedFromSnapshotUrl?: string;
  setDetectedFromSnapshotUrl?: (v: string) => void;
  archivedDetectedFrom?: ArchivedLink | null;
  sourcePostedAtInvalid?: boolean;
  sourceUrlInvalid?: boolean;
}

/** The "Details" section, mirroring the detail page's Details block. Shared by
 *  the submit form and the detection edit form. */
export function DetailsFields({
  sourceUrl,
  setSourceUrl,
  sourceSnapshotUrl,
  setSourceSnapshotUrl,
  archivedSource = null,
  secondarySourceUrls,
  setSecondarySourceUrls,
  secondarySnapshotUrls,
  setSecondarySnapshotUrls,
  archivedCopies,
  eventDate,
  setEventDate,
  eventTime,
  setEventTime,
  sourcePostedAt,
  setSourcePostedAt,
  sourcePostedAtRequired = true,
  isGraphic,
  setIsGraphic,
  graphicLocked = false,
  sourceUrlLocked = false,
  detectedFromUrl,
  detectedFromSnapshotUrl = "",
  setDetectedFromSnapshotUrl,
  archivedDetectedFrom = null,
  sourcePostedAtInvalid = false,
  sourceUrlInvalid = false,
}: DetailsFieldsProps) {
  // A fulfilment can reach here before the request's source has loaded.
  const sourceUrlAsLink = sourceUrlLocked && sourceUrl !== "";

  // Starts open where a value is already staged, so a seeded snapshot is not
  // hidden. The mirrors' equivalent lives in `LinkListInput`.
  const [sourceArchiveOpen, setSourceArchiveOpen] = useState(
    sourceSnapshotUrl !== ""
  );
  const [provenanceArchiveOpen, setProvenanceArchiveOpen] = useState(
    detectedFromSnapshotUrl !== ""
  );
  const sourceArchiveMark = (
    <ArchiveAdornment
      describes={PRIMARY_SOURCE_DESCRIPTION}
      copy={archivedSource}
      expanded={sourceArchiveOpen}
      onToggle={() => setSourceArchiveOpen((open) => !open)}
    />
  );

  const describeMirror = (index: number, url: string) =>
    mirrorDescription(safeHostname(url), index, secondarySourceUrls.length);

  const sourceUrlLabel = (
    <>
      Source URL <FieldHelp concept="source_url" />{" "}
      {sourceUrlLocked && <LockedHint />}
    </>
  );

  return (
    <Card as="section">
      <SectionHeading title="Details" concept="section_details" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Optional: an empty date reads as "Unknown". */}
        <div className="space-y-1.5">
          <label htmlFor="event_date" className={FORM_LABEL}>
            Event date <FieldHelp concept="event_date" />
          </label>
          <DateTimeInput
            id="event_date"
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="event_time" className={FORM_LABEL}>
            Event time <FieldHelp concept="event_time" />
          </label>
          <DateTimeInput
            id="event_time"
            type="time"
            value={eventTime}
            onChange={(e) => setEventTime(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="source_posted_at"
          className={`${FORM_LABEL}${sourcePostedAtInvalid ? ` ${FORM_INVALID_LABEL}` : ""}`}
        >
          Source posted (UTC) <FieldHelp concept="source_posted_at" />
        </label>
        <DateTimeInput
          id="source_posted_at"
          type="datetime-local"
          required={sourcePostedAtRequired}
          value={sourcePostedAt}
          onChange={(e) => setSourcePostedAt(e.target.value)}
          invalid={sourcePostedAtInvalid}
        />
      </div>

      <div className="space-y-1.5">
        {/* A locked URL shows as a link. An anchor is not labelable, so the label
            becomes a `span`. An empty locked field keeps the input. */}
        {sourceUrlAsLink ? (
          <span className={FORM_LABEL}>{sourceUrlLabel}</span>
        ) : (
          <label
            htmlFor="source_url"
            className={`${FORM_LABEL}${sourceUrlInvalid ? ` ${FORM_INVALID_LABEL}` : ""}`}
          >
            {sourceUrlLabel}
          </label>
        )}
        {sourceUrlAsLink ? (
          <LockedUrl href={sourceUrl} trailing={sourceArchiveMark} />
        ) : (
          <Input
            variant={sourceUrlLocked ? "locked" : "default"}
            id="source_url"
            type="url"
            required
            readOnly={sourceUrlLocked}
            value={sourceUrl}
            onChange={(e) => setSourceUrl?.(e.target.value)}
            placeholder="https://t.me/channel/12345"
            invalid={sourceUrlInvalid}
            trailing={sourceArchiveMark}
          />
        )}
        {/* Optional, never part of a publish floor. */}
        {sourceArchiveOpen && (
          <ArchiveSnapshotField
            link={sourceUrl}
            describes={PRIMARY_SOURCE_DESCRIPTION}
            value={sourceSnapshotUrl}
            onChange={setSourceSnapshotUrl}
          />
        )}
      </div>

      {/* Never required. A `span` label: each row input has its own name. */}
      <div className="space-y-1.5">
        <span className={FORM_LABEL}>
          Secondary sources <FieldHelp concept="secondary_source_urls" />
        </span>
        <LinkListInput
          values={secondarySourceUrls}
          onChange={setSecondarySourceUrls}
          max={MAX_SECONDARY_SOURCE_LINKS}
          itemLabel="Secondary source"
          placeholder="https://x.com/user/status/12345"
          companion={{
            values: secondarySnapshotUrls,
            onChange: setSecondarySnapshotUrls,
            trailing: ({ index, url, expanded, toggle }) => (
              <ArchiveAdornment
                describes={describeMirror(index, url)}
                copy={archivedCopies?.get(url.trim()) ?? null}
                expanded={expanded}
                onToggle={toggle}
              />
            ),
            render: ({ index, url, value, onChange }) => (
              <ArchiveSnapshotField
                link={url}
                describes={describeMirror(index, url)}
                value={value}
                onChange={onChange}
              />
            ),
          }}
        />
      </div>

      {/* A `span` label plus the switch's own name: not a labelable field. */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <span className={FORM_LABEL}>
            Graphic content
            {graphicLocked && <LockedHint>admin only</LockedHint>}
          </span>
          <p className="text-xs text-neutral-500">
            {graphicLocked
              ? "This event is flagged. Removing the flag requires an admin, so ask a moderator to review it."
              : "Blurs media behind an age confirmation for viewers. Flag footage showing death, injury or human remains."}
          </p>
        </div>
        <Switch
          on={isGraphic}
          onToggle={() => setIsGraphic(!isGraphic)}
          disabled={graphicLocked}
          aria-label="Graphic content"
        />
      </div>

      {/* Always locked and populated, so always the link form. */}
      {detectedFromUrl && (
        <div className="space-y-1.5">
          <span className={FORM_LABEL}>
            Detected from <FieldHelp concept="detected_from" />
            <LockedHint>provenance, can&apos;t change</LockedHint>
          </span>
          <LockedUrl
            href={detectedFromUrl}
            trailing={
              setDetectedFromSnapshotUrl && (
                <ArchiveAdornment
                  describes={DETECTED_FROM_DESCRIPTION}
                  copy={archivedDetectedFrom}
                  expanded={provenanceArchiveOpen}
                  onToggle={() => setProvenanceArchiveOpen((open) => !open)}
                />
              )
            }
          />
          {setDetectedFromSnapshotUrl && provenanceArchiveOpen && (
            <ArchiveSnapshotField
              link={detectedFromUrl}
              describes={DETECTED_FROM_DESCRIPTION}
              value={detectedFromSnapshotUrl}
              onChange={setDetectedFromSnapshotUrl}
            />
          )}
        </div>
      )}
    </Card>
  );
}
