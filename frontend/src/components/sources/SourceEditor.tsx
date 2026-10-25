"use client";

import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

import { CoordinateInputs } from "@/components/geolocations/CoordinateInputs";
import { MediaManager } from "@/components/geolocations/MediaManager";
import { LockedHint } from "@/components/geolocations/fields/LockedHint";
import {
  ArchiveBox,
  ArchiveSnapshotField,
  linkDescription,
} from "@/components/ui/ArchivedCopies";
import { DateTimeInput } from "@/components/ui/DateTimeInput";
import { Disclosure } from "@/components/ui/Disclosure";
import { CharCounter } from "@/components/ui/CharCounter";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { Card } from "@/components/ui/Card";
import { LEAD_BESIDE_SPLIT } from "@/components/ui/DetailRow";
import { FORM_INVALID_FIELD } from "@/components/ui/form-styles";
import { Input, Select } from "@/components/ui/Input";
import { LinkListInput } from "@/components/ui/LinkListInput";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Switch } from "@/components/ui/Switch";
import { TagsField } from "@/components/ui/TagPicker";
import { cn } from "@/lib/cn";
import { LAT_MAX, LAT_MIN, LNG_MAX, LNG_MIN } from "@/lib/coordinates";
import { safeHostname } from "@/lib/format";
import {
  capturePositionInvalid,
  draftUrls,
  hasCapturePosition,
  LEVEL_LABELS,
  MAX_LINKS_PER_SOURCE,
  SOURCE_FIELDS,
  SOURCE_TITLE_MAX_LEN,
  sourceName,
  SOURCE_URL_MAX_LEN,
  SOURCE_KIND_LABELS,
  SOURCE_KINDS,
  SOURCE_LEVELS,
  type LinkDraft,
  type SourceDraft,
  type SourceKind,
  type SourceLevel,
} from "@/lib/sources";
import type { Media, Tag } from "@/types";

import { SourceImageryCheck } from "./SourceImageryCheck";

const LEVEL_OPTIONS = SOURCE_LEVELS.map((value) => ({ value, label: LEVEL_LABELS[value] }));

/** Which of the editor's fields a publish attempt flagged. */
export interface SourceEditorInvalid {
  link?: boolean;
  kind?: boolean;
  captured?: boolean;
}

/** Whether a field under **More details** holds a value. */
function holdsDetails(draft: SourceDraft): boolean {
  const position =
    hasCapturePosition(draft.kind) && (draft.captureLat.trim() !== "" || draft.captureLng.trim() !== "");
  return draft.capturedAt !== "" || position || draft.tagIds.length > 0 || draft.isGraphic;
}

/**
 * One source block of an event form, in the order the event page's source block reads: the
 * file (uploaded on its own request as soon as it is picked), the title, the level and the
 * kind, then the links with their post time and archived copy (and the imagery provider check
 * on a satellite or aircraft source). **More details** holds the capture time, the capture
 * position (none on a document kind), the tags and the graphic flag. A `wide` editor (the lone
 * source) sets the file beside the title, level and kind once the card is wide enough, the rest
 * under both.
 *
 * The editor holds no draft state of its own: `update` patches the draft in the form's list,
 * and `onPickFile` hands a picked file to the list, which uploads it. `actions` is the
 * header's slot for the list's controls (remove).
 *
 * `variant="site-image"` is a site's satellite image: its kind and level are fixed (satellite,
 * context), so neither shows, the capture time is required and sits under the title, and
 * `extra` (the image's note) closes the card in place of **More details**.
 */
export function SourceEditor({
  draft,
  index,
  update,
  onPickFile,
  tags,
  setTags,
  invalid = {},
  actions,
  wide = false,
  variant = "event",
  name = sourceName(index),
  extra,
}: {
  draft: SourceDraft;
  /** Position in the list, for the names ("Source 2"). */
  index: number;
  update: (patch: Partial<SourceDraft>) => void;
  onPickFile: (file: File) => void;
  /** The tag catalogue the event's Details card also reads; an event source only. */
  tags?: Tag[];
  setTags?: Dispatch<SetStateAction<Tag[]>>;
  invalid?: SourceEditorInvalid;
  actions?: ReactNode;
  /** The editor owns the whole section (a lone source): the file sits left of the fields once
   *  the card is wide enough. */
  wide?: boolean;
  variant?: "event" | "site-image";
  /** The card's heading, and the root of its fields' accessible names. */
  name?: string;
  /** What a site image adds after its links: the note. */
  extra?: ReactNode;
}) {
  const siteImage = variant === "site-image";
  const id = (field: string) => `${draft.key}-${field}`;
  const file = draft.file;
  const hasFile = file !== null && file.state !== "failed";
  const positionInvalid = capturePositionInvalid(draft);
  // Opens on a source that already says more than the essentials; the analyst closes it.
  const [detailsOpen, setDetailsOpen] = useState(() => holdsDetails(draft));

  // A picked file previews from its object URL until the staged copy answers.
  const pending = file?.state === "uploading" ? file.file : null;
  const pendingFiles = useMemo(() => (pending ? [pending] : []), [pending]);
  // A staged upload is a source file, so it has derivatives like a stored one.
  const shown: Media | null =
    file?.state === "stored"
      ? file.media
      : file?.state === "staged"
        ? { ...file.upload, role: "source" }
        : null;

  const describe = (i: number, url: string) =>
    linkDescription(siteImage ? name.toLowerCase() : index, safeHostname(url.trim()), i, draft.links.length);

  const fileSlot = (
    <div className="space-y-1.5">
      <FieldLabel {...SOURCE_FIELDS.file} />
      <MediaManager
        existing={shown ? [shown] : []}
        onRemoveExisting={() => update({ file: null })}
        staged={pendingFiles}
        onRemoveStaged={() => update({ file: null })}
        onAddFiles={hasFile ? undefined : (files) => files[0] && onPickFile(files[0])}
        isGraphic={draft.graphicLocked}
      />
      {file?.state === "uploading" && (
        <p className="text-xs text-neutral-500" role="status">
          Uploading {file.file.name}…
        </p>
      )}
      {file?.state === "failed" && (
        <p className="text-xs text-red-400" role="alert">
          {file.file.name}: {file.error}
        </p>
      )}
    </div>
  );

  // Required on a site image, where the zone rule reads it; optional under More details otherwise.
  const captured = (
    <div className="space-y-1.5">
      <FieldLabel
        {...SOURCE_FIELDS.captured_at}
        htmlFor={id("captured_at")}
        invalid={invalid.captured}
      />
      <DateTimeInput
        id={id("captured_at")}
        type="datetime-local"
        value={draft.capturedAt}
        required={siteImage}
        invalid={invalid.captured}
        onChange={(e) => update({ capturedAt: e.target.value })}
      />
    </div>
  );

  const classification = (
    <>
      <div className="space-y-1.5">
        <FieldLabel {...SOURCE_FIELDS.level} />
        <SegmentedControl<SourceLevel>
          aria-label={`${name} level`}
          options={LEVEL_OPTIONS}
          value={draft.level}
          onChange={(level) => update({ level })}
          fullWidth
        />
      </div>

      <div className="space-y-1.5">
        <FieldLabel {...SOURCE_FIELDS.kind} htmlFor={id("kind")} invalid={invalid.kind} />
        <Select
          id={id("kind")}
          value={draft.kind}
          required
          invalid={invalid.kind}
          onChange={(e) => update({ kind: e.target.value as SourceKind | "" })}
        >
          <option value="">Pick a kind</option>
          {SOURCE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {SOURCE_KIND_LABELS[kind]}
            </option>
          ))}
        </Select>
      </div>
    </>
  );

  const essentials = (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <FieldLabel
          {...SOURCE_FIELDS.title}
          htmlFor={id("title")}
          trailing={<CharCounter length={draft.title.length} max={SOURCE_TITLE_MAX_LEN} />}
        />
        <Input
          id={id("title")}
          // Named apart from the event's Title field and the other editors' titles.
          aria-label={`${name} title`}
          value={draft.title}
          maxLength={SOURCE_TITLE_MAX_LEN}
          onChange={(e) => update({ title: e.target.value })}
          placeholder={
            siteImage ? "For example Sentinel-2 true colour" : "For example Drone footage of the strike"
          }
        />
      </div>

      {siteImage ? captured : classification}
    </div>
  );

  const details = (
    <Disclosure
      label="More details"
      open={detailsOpen}
      onToggle={() => setDetailsOpen((open) => !open)}
    >
      {captured}

      {hasCapturePosition(draft.kind) && (
        <div className="space-y-1.5">
          <FieldLabel {...SOURCE_FIELDS.capture_position} />
          <CoordinateInputs
            idPrefix={id("capture_")}
            required={false}
            lat={draft.captureLat}
            setLat={(captureLat) => update({ captureLat })}
            lng={draft.captureLng}
            setLng={(captureLng) => update({ captureLng })}
            invalid={positionInvalid}
          />
          {positionInvalid && (
            <p className="text-xs text-red-400">
              Enter a latitude from {LAT_MIN} to {LAT_MAX} and a longitude from {LNG_MIN} to{" "}
              {LNG_MAX}, or clear both. Until then the capture position is not saved.
            </p>
          )}
        </div>
      )}

      {tags && setTags && (
        <TagsField
          tags={tags}
          setTags={setTags}
          selected={draft.tagIds}
          setSelected={(tagIds) => update({ tagIds })}
          owner={name}
        />
      )}

      {/* A `span` label plus the switch's own name: not a labelable field. */}
      <div className="flex items-center justify-between gap-4">
        <FieldLabel
          {...SOURCE_FIELDS.is_graphic}
          trailing={draft.graphicLocked && <LockedHint>admin only</LockedHint>}
        />
        <Switch
          on={draft.isGraphic}
          onToggle={() => update({ isGraphic: !draft.isGraphic })}
          disabled={draft.graphicLocked}
          aria-label={`${name} graphic content`}
        />
      </div>
    </Disclosure>
  );

  const rest = (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className={invalid.link && draft.links.length === 0 ? FORM_INVALID_FIELD : undefined}>
          <LinkListInput<LinkDraft>
            rows={draft.links}
            onChange={(links) => update({ links })}
            urlOf={(link) => link.url}
            withUrl={(link, url) => ({ ...link, url })}
            blank={() => ({ url: "", postedAt: "", snapshotUrl: "", stored: null })}
            max={MAX_LINKS_PER_SOURCE}
            maxLength={SOURCE_URL_MAX_LEN}
            itemLabel={`${name} link`}
            addText="Add a link"
            addName={`Add a link to ${name.toLowerCase()}`}
            placeholder={
              siteImage ? "https://browser.dataspace.copernicus.eu/?…" : "https://t.me/channel/12345"
            }
            invalid={invalid.link}
            heading={
              <FieldLabel
                {...SOURCE_FIELDS.links}
                label={`${SOURCE_FIELDS.links.label} (${draftUrls(draft).length})`}
                invalid={invalid.link}
              />
            }
            columns={[
              {
                header: "Posted (UTC)",
                width: "13rem",
                cell: ({ index: i, row, update: updateLink }) => (
                  <DateTimeInput
                    type="datetime-local"
                    variant="compact"
                    aria-label={`Posted (UTC), ${describe(i, row.url)}`}
                    title="When the file was posted at this link (UTC)"
                    value={row.postedAt}
                    onChange={(e) => updateLink({ ...row, postedAt: e.target.value })}
                  />
                ),
              },
              {
                header: "Archive",
                width: "auto",
                cell: ({ index: i, row, expanded, toggle }) => (
                  <ArchiveBox
                    describes={describe(i, row.url)}
                    snapshot={row.snapshotUrl}
                    expanded={expanded}
                    onToggle={toggle}
                  />
                ),
              },
            ]}
            expansion={({ index: i, row, update: updateLink }) => (
              <ArchiveSnapshotField
                link={row.url}
                describes={describe(i, row.url)}
                value={row.snapshotUrl}
                onChange={(snapshotUrl) => updateLink({ ...row, snapshotUrl })}
              />
            )}
          />
        </div>
        <SourceImageryCheck draft={draft} name={name} />
      </div>

      {siteImage ? extra : details}
    </div>
  );

  return (
    <Card as="section" aria-label={name} dense className="@container">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-neutral-200">{name}</h3>
        <div className="flex flex-wrap items-center gap-1">{actions}</div>
      </header>
      {/* A lone editor reads like the event page's lone source: once the card is 42rem wide the
          file sits left of the title, level and kind, 3:2 (`DetailCard leadBeside`), and the links
          and More details take the card's width under both, so a link keeps its one-row layout;
          narrower, everything stacks. */}
      <div className={cn("grid gap-4", wide && cn(LEAD_BESIDE_SPLIT, "@2xl:gap-x-5"))}>
        {fileSlot}
        {essentials}
        <div className={cn(wide && "@2xl:col-span-2")}>{rest}</div>
      </div>
    </Card>
  );
}
