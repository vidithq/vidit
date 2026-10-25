"use client";

import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

import { CoordinateInputs } from "@/components/geolocations/CoordinateInputs";
import { MediaManager } from "@/components/geolocations/MediaManager";
import { LockedHint } from "@/components/geolocations/new/LockedHint";
import {
  ArchiveBox,
  ArchiveSnapshotField,
  linkDescription,
} from "@/components/ui/ArchivedCopies";
import { DateTimeInput } from "@/components/ui/DateTimeInput";
import { Disclosure } from "@/components/ui/Disclosure";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { Card } from "@/components/ui/Card";
import {
  FORM_INVALID_FIELD,
  FORM_INVALID_LABEL,
  FORM_LABEL,
  LABEL_TEXT,
} from "@/components/ui/form-styles";
import { Input, Select } from "@/components/ui/Input";
import { LinkListInput } from "@/components/ui/LinkListInput";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Switch } from "@/components/ui/Switch";
import { TagChips } from "@/components/ui/TagPicker";
import { cn } from "@/lib/cn";
import { MAX_LINKS_PER_SOURCE } from "@/lib/events";
import { safeHostname } from "@/lib/format";
import {
  draftUrls,
  hasCapturePosition,
  LEVEL_LABELS,
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

// A label and its `?` side by side. The `?` sits outside a `<label>`, so the field's accessible
// name stays the label's words.
const LABEL_ROW = "flex items-center gap-1";

const LEVEL_OPTIONS = SOURCE_LEVELS.map((value) => ({ value, label: LEVEL_LABELS[value] }));

/** Which of the editor's fields a publish attempt flagged. */
export interface SourceEditorInvalid {
  link?: boolean;
  kind?: boolean;
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
 * source) sets the file beside the fields once the card is wide enough.
 *
 * The editor holds no draft state of its own: `update` patches the draft in the form's list,
 * and `onPickFile` hands a picked file to the list, which uploads it. `actions` is the
 * header's slot for the list's controls (remove).
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
}: {
  draft: SourceDraft;
  /** Position in the list, for the names ("Source 2"). */
  index: number;
  update: (patch: Partial<SourceDraft>) => void;
  onPickFile: (file: File) => void;
  /** The tag catalogue the event's Details card also reads. */
  tags: Tag[];
  setTags: Dispatch<SetStateAction<Tag[]>>;
  invalid?: SourceEditorInvalid;
  actions?: ReactNode;
  /** The editor owns the whole section (a lone source): the file sits left of the fields once
   *  the card is wide enough. */
  wide?: boolean;
}) {
  const name = `Source ${index + 1}`;
  const id = (field: string) => `${draft.key}-${field}`;
  const file = draft.file;
  const hasFile = file !== null && file.state !== "failed";
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
    linkDescription(index, safeHostname(url.trim()), i, draft.links.length);

  const fileSlot = (
    <div className="space-y-1.5">
      <span className={cn(LABEL_ROW, LABEL_TEXT)}>
        File <FieldHelp concept="source_file" />
      </span>
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

  const fields = (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor={id("title")} className={FORM_LABEL}>
          Title
        </label>
        <Input
          id={id("title")}
          // Named apart from the event's Title field and the other editors' titles.
          aria-label={`${name} title`}
          value={draft.title}
          maxLength={255}
          onChange={(e) => update({ title: e.target.value })}
          placeholder="For example Drone footage of the strike"
        />
      </div>

      <div className="space-y-1.5">
        <span className={cn(LABEL_ROW, LABEL_TEXT)}>
          Level <FieldHelp concept="source_level" />
        </span>
        <SegmentedControl<SourceLevel>
          aria-label={`${name} level`}
          options={LEVEL_OPTIONS}
          value={draft.level}
          onChange={(level) => update({ level })}
          fullWidth
        />
      </div>

      <div className="space-y-1.5">
        <span className={LABEL_ROW}>
          <label htmlFor={id("kind")} className={cn(LABEL_TEXT, invalid.kind && FORM_INVALID_LABEL)}>
            Kind
          </label>
          <FieldHelp concept="source_kind" />
        </span>
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

      <div className="space-y-1.5">
        <div className={invalid.link && draft.links.length === 0 ? FORM_INVALID_FIELD : undefined}>
          <LinkListInput<LinkDraft>
            rows={draft.links}
            onChange={(links) => update({ links })}
            urlOf={(link) => link.url}
            withUrl={(link, url) => ({ ...link, url })}
            blank={() => ({ url: "", postedAt: "", snapshotUrl: "", stored: null })}
            max={MAX_LINKS_PER_SOURCE}
            itemLabel={`${name} link`}
            addText="Add a link"
            addName={`Add a link to ${name.toLowerCase()}`}
            placeholder="https://t.me/channel/12345"
            invalid={invalid.link}
            heading={
              <span className={LABEL_ROW}>
                Links ({draftUrls(draft).length}) <FieldHelp concept="source_links" />
              </span>
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

      <Disclosure
        label="More details"
        open={detailsOpen}
        onToggle={() => setDetailsOpen((open) => !open)}
      >
        <div className="space-y-1.5">
          <span className={LABEL_ROW}>
            <label htmlFor={id("captured_at")} className={LABEL_TEXT}>
              Captured
            </label>
            <FieldHelp concept="captured_at" />
          </span>
          <DateTimeInput
            id={id("captured_at")}
            type="datetime-local"
            value={draft.capturedAt}
            onChange={(e) => update({ capturedAt: e.target.value })}
          />
        </div>

        {hasCapturePosition(draft.kind) && (
          <div className="space-y-1.5">
            <span className={cn(LABEL_ROW, LABEL_TEXT)}>
              Capture position <FieldHelp concept="capture_position" />
            </span>
            <CoordinateInputs
              idPrefix={id("capture_")}
              required={false}
              lat={draft.captureLat}
              setLat={(captureLat) => update({ captureLat })}
              lng={draft.captureLng}
              setLng={(captureLng) => update({ captureLng })}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <span className={FORM_LABEL}>Tags</span>
          <TagChips
            tags={tags}
            setTags={setTags}
            selected={draft.tagIds}
            setSelected={(tagIds) => update({ tagIds })}
            owner={name}
          />
        </div>

        {/* A `span` label plus the switch's own name: not a labelable field. */}
        <div className="flex items-center justify-between gap-4">
          <span className={cn(LABEL_ROW, LABEL_TEXT)}>
            Graphic content <FieldHelp concept="graphic_content" />
            {draft.graphicLocked && <LockedHint>admin only</LockedHint>}
          </span>
          <Switch
            on={draft.isGraphic}
            onToggle={() => update({ isGraphic: !draft.isGraphic })}
            disabled={draft.graphicLocked}
            aria-label={`${name} graphic content`}
          />
        </div>
      </Disclosure>
    </div>
  );

  return (
    <Card as="section" aria-label={name} className="@container">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-neutral-200">{name}</h3>
        <div className="flex flex-wrap items-center gap-1">{actions}</div>
      </header>
      {/* A lone editor reads like the event page's lone source: once the card is 42rem wide the
          file sits left of the fields, 3:2 (`DetailCard leadBeside`); narrower, it stays on top. */}
      <div className={cn("grid gap-4", wide && "@2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @2xl:gap-5")}>
        {fileSlot}
        {fields}
      </div>
    </Card>
  );
}
