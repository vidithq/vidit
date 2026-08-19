"use client";

import { useState, type ReactNode } from "react";

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
  /** Omit when `sourceUrlLocked` — a read-only field never calls it. */
  setSourceUrl?: (v: string) => void;
  /** The snapshot of the source URL the analyst archived while filling the
   *  form, posted with it as `source_snapshot_url`. Optional to fill, but the
   *  pair is always wired: archival belongs where the source is typed. */
  sourceSnapshotUrl: string;
  setSourceSnapshotUrl: (v: string) => void;
  /** The copy the event already carries (the edit form); null on a fresh
   *  submit, where nothing has been archived yet. */
  archivedSource?: ArchivedLink | null;
  /** Optional mirrors of the same media. Editable on every path, including a
   *  fulfilment (the geolocate transition replaces the whole list), so unlike
   *  the primary source it has no locked mode here. */
  secondarySourceUrls: string[];
  setSecondarySourceUrls: (v: string[]) => void;
  /** One archived-copy paste per mirror, index-aligned with the list above and
   *  posted as `secondary_snapshot_urls`. A mirror rots like the primary, so
   *  every declared link carries the same optional field. */
  secondarySnapshotUrls: string[];
  setSecondarySnapshotUrls: (v: string[]) => void;
  /** The copies the event already carries, keyed by the link each covers
   *  (`archivedCopies`). Keyed rather than positional because the rows are
   *  edited: a mirror shows the copy recorded for the URL it holds now. */
  archivedCopies?: ReadonlyMap<string, ArchivedLink>;
  eventDate: string;
  setEventDate: (v: string) => void;
  /** Optional event time-of-day ("HH:MM", UTC). */
  eventTime: string;
  setEventTime: (v: string) => void;
  /** When the source posted the media: a datetime-local value
   *  ("YYYY-MM-DDTHH:MM", UTC). Required: a post always has a time. */
  sourcePostedAt: string;
  setSourcePostedAt: (v: string) => void;
  /** The author's graphic-content declaration. Never required: an unflagged
   *  event is a complete form. */
  isGraphic: boolean;
  setIsGraphic: (v: boolean) => void;
  /** The loaded event already carries the flag. The declaration ratchets on
   *  the backend (the form raises it and never lowers it), so the switch reads
   *  its state and refuses the toggle instead of offering a change the
   *  geolocate write would discard. A fresh submit leaves this `false` (nothing
   *  is set yet); fulfilling a flagged request sets it, like the edit form. */
  graphicLocked?: boolean;
  /** Render the source URL read-only: it is inherited from the request on a
   *  fulfilment, which shows a "from request" hint. Both owner edit shapes
   *  leave it editable, so they omit it. */
  sourceUrlLocked?: boolean;
  /** What the locked marker on the source URL says. Defaults to `LockedHint`'s
   *  "from request". */
  sourceLockNote?: ReactNode;
  /** A machine detection's provenance — the post it was imported from. Shown
   *  read-only inside this block (it's the one immutable field) when provided;
   *  the submit form omits it. */
  detectedFromUrl?: string | null;
  /** The snapshot of that provenance link, posted as
   *  `detected_from_snapshot_url`. Only the published-row edit declares the
   *  field, so the pair is passed only there; without the setter the locked
   *  field renders bare, as it does on the detection submit form. */
  detectedFromSnapshotUrl?: string;
  setDetectedFromSnapshotUrl?: (v: string) => void;
  /** The copy the provenance link already carries, if any. */
  archivedDetectedFrom?: ArchivedLink | null;
  /** Flag the source-time / source-URL inputs as missing. */
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
  isGraphic,
  setIsGraphic,
  graphicLocked = false,
  sourceUrlLocked = false,
  sourceLockNote,
  detectedFromUrl,
  detectedFromSnapshotUrl = "",
  setDetectedFromSnapshotUrl,
  archivedDetectedFrom = null,
  sourcePostedAtInvalid = false,
  sourceUrlInvalid = false,
}: DetailsFieldsProps) {
  // A fulfilment can reach here before the request's source has loaded, so the
  // link mode needs a value, not just the locked flag.
  const sourceUrlAsLink = sourceUrlLocked && sourceUrl !== "";

  // The source's paste line opens on the mark, and starts open where a value is
  // already staged: a seeded snapshot nothing displays is one nobody can
  // correct. The mirrors' equivalent lives in `LinkListInput`, which is what
  // keeps a row's open line aligned with its link across an add or a removal.
  const [sourceArchiveOpen, setSourceArchiveOpen] = useState(
    sourceSnapshotUrl !== ""
  );
  // The provenance link's own line, on the same rule as the source's above.
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

  // One mirror's name, said the same way in the mark and in the line under it.
  const describeMirror = (index: number, url: string) =>
    mirrorDescription(safeHostname(url), index, secondarySourceUrls.length);

  // One label, worn by whichever element ends up carrying it.
  const sourceUrlLabel = (
    <>
      Source URL <FieldHelp concept="source_url" />{" "}
      {sourceUrlLocked && <LockedHint>{sourceLockNote}</LockedHint>}
    </>
  );

  return (
    <Card as="section">
      <SectionHeading title="Details" concept="section_details" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Optional on every path: the footage doesn't always establish when
            the depicted event happened; an empty date reads as "Unknown". */}
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
          required
          value={sourcePostedAt}
          onChange={(e) => setSourcePostedAt(e.target.value)}
          invalid={sourcePostedAtInvalid}
        />
      </div>

      <div className="space-y-1.5">
        {/* A locked field holding a URL shows that URL as a link, so it can be
            opened without being retyped. A `label` needs a labelable control
            and an anchor is not one, so the label becomes a `span` in that
            mode, as the secondary-sources and graphic-content blocks do. An
            empty locked field keeps the input: there is no link to render. */}
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
        {/* Archival rides the field holding the link it archives, on the form
            where that link is typed: a source is most archivable while the
            analyst still has it open. The paste line opens under the field, so
            the copy and the link it covers read as one thing. Optional, and
            never part of a publish floor. */}
        {sourceArchiveOpen && (
          <ArchiveSnapshotField
            link={sourceUrl}
            describes={PRIMARY_SOURCE_DESCRIPTION}
            value={sourceSnapshotUrl}
            onChange={setSourceSnapshotUrl}
          />
        )}
      </div>

      {/* The mirrors sit under the primary they mirror. Never required, so no
          invalid state and no readiness entry: an empty list is a complete
          form. A `span` label, not a `label`: the rows are a list, and each
          input carries its own accessible name.

          Each row carries the same archival brick as the Source URL above it,
          because a mirror rots the same way. */}
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

      {/* The graphic-content declaration. A `span` label plus the switch's own
          accessible name, matching the secondary-sources block above: the
          control is not a labelable field the browser can associate a
          `<label>` with. */}
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

      {/* Always locked and always populated (the block renders on a value), so
          it is always the link form. Locked names the link, not its archived
          copy: the post rots like any other source, so where the write path
          takes the paste the field carries the same mark and the same line as
          the Source URL above. */}
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
