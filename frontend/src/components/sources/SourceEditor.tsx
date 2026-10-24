"use client";

import { useMemo, type Dispatch, type ReactNode, type SetStateAction } from "react";

import { CoordinateInputs } from "@/components/geolocations/CoordinateInputs";
import { MediaManager } from "@/components/geolocations/MediaManager";
import { LockedHint } from "@/components/geolocations/new/LockedHint";
import {
  ArchiveAdornment,
  ArchiveSnapshotField,
  linkDescription,
} from "@/components/ui/ArchivedCopies";
import { DateTimeInput } from "@/components/ui/DateTimeInput";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { FORM_INVALID_FIELD, FORM_INVALID_LABEL, FORM_LABEL, LIST_TILE } from "@/components/ui/form-styles";
import { Input, Select } from "@/components/ui/Input";
import { LinkListInput } from "@/components/ui/LinkListInput";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Switch } from "@/components/ui/Switch";
import { TagChips } from "@/components/ui/TagPicker";
import { cn } from "@/lib/cn";
import { MAX_LINKS_PER_SOURCE } from "@/lib/events";
import { safeHostname } from "@/lib/format";
import {
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

const LEVEL_OPTIONS = SOURCE_LEVELS.map((value) => ({ value, label: LEVEL_LABELS[value] }));

/** Which of the editor's fields a publish attempt flagged. */
export interface SourceEditorInvalid {
  link?: boolean;
  kind?: boolean;
}

/**
 * One source block of an event form: the file (uploaded on its own request as soon as it is
 * picked), the level, the kind, the capture time, the capture position (none on a document
 * kind), the links with their post time and archived copy, the tags and the graphic flag.
 *
 * The editor holds no state of its own: `update` patches the draft in the form's list, and
 * `onPickFile` hands a picked file to the list, which uploads it. `actions` is the header's
 * slot for the list's controls (merge, remove).
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
}: {
  draft: SourceDraft;
  /** Position in the list, for the names ("Source 2"). */
  index: number;
  update: (patch: Partial<SourceDraft>) => void;
  onPickFile: (file: File) => void;
  /** The tag catalogue the event's Classification also reads. */
  tags: Tag[];
  setTags: Dispatch<SetStateAction<Tag[]>>;
  invalid?: SourceEditorInvalid;
  actions?: ReactNode;
}) {
  const name = `Source ${index + 1}`;
  const id = (field: string) => `${draft.key}-${field}`;
  const file = draft.file;
  const hasFile = file !== null && file.state !== "failed";

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

  return (
    <section aria-label={name} className={cn(LIST_TILE, "space-y-4")}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-neutral-200">{name}</h3>
        <div className="flex flex-wrap items-center gap-1">{actions}</div>
      </header>

      <div className="space-y-1.5">
        <label htmlFor={id("title")} className={FORM_LABEL}>
          Source title
        </label>
        <Input
          id={id("title")}
          value={draft.title}
          maxLength={255}
          onChange={(e) => update({ title: e.target.value })}
          placeholder="Optional, for example Drone footage of the strike"
        />
      </div>

      <div className="space-y-1.5">
        <span className={FORM_LABEL}>
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <span className={FORM_LABEL}>
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
          <label
            htmlFor={id("kind")}
            className={cn(FORM_LABEL, invalid.kind && FORM_INVALID_LABEL)}
          >
            Kind <FieldHelp concept="source_kind" />
          </label>
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
      </div>

      <div className="space-y-1.5">
        <label htmlFor={id("captured_at")} className={FORM_LABEL}>
          Captured (UTC) <FieldHelp concept="captured_at" />
        </label>
        <DateTimeInput
          id={id("captured_at")}
          type="datetime-local"
          value={draft.capturedAt}
          onChange={(e) => update({ capturedAt: e.target.value })}
        />
      </div>

      {hasCapturePosition(draft.kind) && (
        <div className="space-y-1.5">
          <span className={FORM_LABEL}>
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
        <span className={cn(FORM_LABEL, invalid.link && FORM_INVALID_LABEL)}>
          Links <FieldHelp concept="source_links" />
        </span>
        <div className={invalid.link && draft.links.length === 0 ? FORM_INVALID_FIELD : undefined}>
          <LinkListInput<LinkDraft>
            rows={draft.links}
            onChange={(links) => update({ links })}
            urlOf={(link) => link.url}
            withUrl={(link, url) => ({ ...link, url })}
            blank={() => ({ url: "", postedAt: "", snapshotUrl: "", stored: null })}
            max={MAX_LINKS_PER_SOURCE}
            itemLabel={`${name} link`}
            placeholder="https://t.me/channel/12345"
            invalid={invalid.link}
            trailing={({ index: i, row, expanded, toggle }) => (
              <ArchiveAdornment
                describes={describe(i, row.url)}
                copy={row.stored?.url === row.url.trim() ? row.stored.archived : null}
                expanded={expanded}
                onToggle={toggle}
              />
            )}
            detail={({ index: i, row, update: updateLink }) => (
              <DateTimeInput
                type="datetime-local"
                variant="compact"
                aria-label={`Posted (UTC), ${describe(i, row.url)}`}
                title="When the file was posted at this link (UTC)"
                value={row.postedAt}
                onChange={(e) => updateLink({ ...row, postedAt: e.target.value })}
              />
            )}
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
      </div>

      <div className="space-y-1.5">
        <span className={FORM_LABEL}>Tags</span>
        <TagChips
          tags={tags}
          setTags={setTags}
          selectedTagIds={draft.tagIds}
          setSelectedTagIds={(tagIds) => update({ tagIds })}
          owner={name}
        />
      </div>

      {/* A `span` label plus the switch's own name: not a labelable field. */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <span className={FORM_LABEL}>
            Graphic content
            {draft.graphicLocked && <LockedHint>admin only</LockedHint>}
          </span>
          <p className="text-xs text-neutral-500">
            {draft.graphicLocked
              ? "This source is flagged. Removing the flag requires an admin, so ask a moderator to review it."
              : "Blurs this source's file behind an age confirmation for viewers. Flag footage showing death, injury or human remains."}
          </p>
        </div>
        <Switch
          on={draft.isGraphic}
          onToggle={() => update({ isGraphic: !draft.isGraphic })}
          disabled={draft.graphicLocked}
          aria-label={`${name} graphic content`}
        />
      </div>
    </section>
  );
}
