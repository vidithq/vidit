"use client";

import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Download } from "lucide-react";

import { CoordinateInputs } from "@/components/geolocations/CoordinateInputs";
import { MediaManager } from "@/components/geolocations/MediaManager";
import { LockedHint } from "@/components/geolocations/fields/LockedHint";
import {
  ArchiveBox,
  ArchiveSnapshotField,
  linkDescription,
} from "@/components/sources/ArchivedCopies";
import { Button } from "@/components/ui/Button";
import { DateTimeInput } from "@/components/ui/DateTimeInput";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { Card } from "@/components/ui/Card";
import { LEAD_BESIDE_SPLIT } from "@/components/ui/DetailRow";
import { FORM_INVALID_FIELD } from "@/components/ui/form-styles";
import { Input, Select } from "@/components/ui/Input";
import { LinkListInput, type LinkListRow } from "@/components/ui/LinkListInput";
import { OptionSearch } from "@/components/ui/OptionSearch";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Switch } from "@/components/ui/Switch";
import { TagsField } from "@/components/ui/TagPicker";
import { cn } from "@/lib/cn";
import { safeHostname } from "@/lib/format";
import {
  capturePositionInvalid,
  draftUrls,
  hasCapturePosition,
  isImportableLink,
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
  type LinkPost,
  type SourceDraft,
  type SourceKind,
  type SourceLevel,
} from "@/lib/sources";
import type { Media, Tag } from "@/types";

import { SourceHeader } from "./SourceBlock";
import { SourceImageryCheck } from "./SourceImageryCheck";
import { FieldError } from "@/components/ui/ErrorNotice";

const LEVEL_OPTIONS = SOURCE_LEVELS.map((value) => ({ value, label: LEVEL_LABELS[value] }));
const KIND_OPTIONS = SOURCE_KINDS.map((value) => ({ value, label: SOURCE_KIND_LABELS[value] }));

/** Which of the editor's fields a publish attempt flagged. */
export interface SourceEditorInvalid {
  link?: boolean;
  captured?: boolean;
}

/** Whether a field under **Capture details** holds a value, the level counting once it is not
 *  Direct. */
export function holdsCaptureDetails(draft: SourceDraft): boolean {
  const position =
    hasCapturePosition(draft.kind) && (draft.captureLat.trim() !== "" || draft.captureLng.trim() !== "");
  return (
    draft.title.trim() !== "" ||
    draft.level !== "direct" ||
    draft.capturedAt !== "" ||
    position ||
    draft.tagIds.length > 0 ||
    draft.isGraphic
  );
}

/**
 * One source block of an event form: the file (uploaded on its own request as soon as it is
 * picked), the kind, then the links with their post time and archived copy (and the imagery
 * provider check on a satellite or aircraft source). **Capture details**, at the foot, holds the
 * title, the level, the capture time, the capture position (none on a document kind), the tags
 * and the graphic flag; it opens by itself on a source where one of them holds a value or the
 * level is not Direct. A `wide` editor (the lone source) sets the file beside the kind once the
 * card is wide enough, the links and **Capture details** under both.
 *
 * The editor holds no draft state of its own: `update` patches the draft in the form's list,
 * `onPickFile` hands a picked file to the list, which uploads it, `onImportLink` hands it a
 * link whose post's file it imports, and `onCopyProofImage` one of `proofImages`, the stored proof
 * images the slot may take a copy of while it is empty. `actions` is the header's slot for the list's controls
 * (remove).
 *
 * `variant="site-source"` is a site's satellite source: its kind and level are fixed (satellite,
 * context), so neither shows, and the required capture time sits beside the file. Its foot is
 * **Title and note**, the title and `extra` (the source's note), which opens by itself when
 * either holds a value (`extraHolds`).
 */
export function SourceEditor({
  draft,
  index,
  update,
  onPickFile,
  onImportLink,
  proofImages = [],
  onCopyProofImage = () => {},
  tags,
  setTags,
  suggestedTags,
  invalid = {},
  actions,
  wide = false,
  variant = "event",
  name = sourceName(index),
  extra,
  extraHolds = false,
}: {
  draft: SourceDraft;
  /** Position in the list, for the names ("Source 2"). */
  index: number;
  update: (patch: Partial<SourceDraft>) => void;
  onPickFile: (file: File) => void;
  onImportLink: (post: LinkPost) => void;
  /** The URLs of the proof images the slot offers, in proof order; empty offers none. */
  proofImages?: string[];
  onCopyProofImage?: (url: string) => void;
  /** The tag catalogue the event's Details card also reads; an event source only. */
  tags?: Tag[];
  setTags?: Dispatch<SetStateAction<Tag[]>>;
  suggestedTags?: Tag[];
  invalid?: SourceEditorInvalid;
  actions?: ReactNode;
  /** The editor owns the whole section (a lone source): the file sits left of the fields once
   *  the card is wide enough. */
  wide?: boolean;
  variant?: "event" | "site-source";
  /** The card's heading, and the root of its fields' accessible names. */
  name?: string;
  /** What a site source adds to its foot, after the title: the note. */
  extra?: ReactNode;
  /** `extra` holds a value, which opens the foot. */
  extraHolds?: boolean;
}) {
  const siteSource = variant === "site-source";
  const id = (field: string) => `${draft.key}-${field}`;
  const file = draft.file;
  const hasFile = file !== null && file.state !== "failed";
  const positionInvalid = capturePositionInvalid(draft);
  // Opens on a source that already says more than the essentials; the analyst closes it.
  const [footOpen, setFootOpen] = useState(() =>
    siteSource ? draft.title.trim() !== "" || extraHolds : holdsCaptureDetails(draft),
  );
  // An X link's post time is filled by the write, so the column waits for a value or the foot.
  const showPosted = footOpen || draft.links.some((link) => link.postedAt !== "");

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

  const post = file?.state === "importing" || file?.state === "staged" ? file.post : undefined;
  const copied = file?.state === "copying" || file?.state === "staged" ? file.proof : undefined;
  const copiedIndex = copied === undefined ? -1 : proofImages.indexOf(copied);
  const proofLabel = (i: number) => `Proof image ${i + 1} of ${proofImages.length}`;

  const describe = (i: number, url: string) =>
    linkDescription(siteSource ? name.toLowerCase() : index, safeHostname(url.trim()), i, draft.links.length);

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
      {!hasFile && proofImages.length > 0 && (
        <Button
          action="useProof"
          variant="ghost"
          onClick={() => onCopyProofImage(proofImages[0])}
          aria-label={`Use a proof image as the file of ${name.toLowerCase()}`}
        >
          Use a proof image
        </Button>
      )}
      {file?.state === "copying" && (
        <p className="text-xs text-neutral-500" role="status">
          Copying {copiedIndex >= 0 ? proofLabel(copiedIndex).toLowerCase() : "the proof image"}…
        </p>
      )}
      {copiedIndex >= 0 && proofImages.length > 1 && (
        <Select
          aria-label={`${name} proof image`}
          value={copiedIndex}
          disabled={file?.state === "copying"}
          onChange={(e) => onCopyProofImage(proofImages[Number(e.target.value)])}
        >
          {proofImages.map((url, i) => (
            <option key={url} value={i}>
              {proofLabel(i)}
            </option>
          ))}
        </Select>
      )}
      {file?.state === "importing" && (
        <p className="text-xs text-neutral-500" role="status">
          Importing the file from {safeHostname(file.post.url)}…
        </p>
      )}
      {post && post.kinds.length > 1 && (
        <Select
          aria-label={`${name} file from the post`}
          value={post.index}
          disabled={file?.state === "importing"}
          onChange={(e) => onImportLink({ ...post, index: Number(e.target.value) })}
        >
          {post.kinds.map((kind, i) => (
            <option key={i} value={i}>
              File {i + 1} of {post.kinds.length} ({kind === "image" ? "photo" : kind})
            </option>
          ))}
        </Select>
      )}
      {file?.state === "failed" && (
        <FieldError alert>
          {file.name}: {file.error}
        </FieldError>
      )}
    </div>
  );

  // Required on a site source, where the zone rule reads it; optional under Capture details otherwise.
  const captured = (
    <div className="space-y-1.5">
      <FieldLabel
        {...SOURCE_FIELDS.captured_at}
        concept={siteSource ? "site_source_captured" : SOURCE_FIELDS.captured_at.concept}
        htmlFor={id("captured_at")}
        invalid={invalid.captured}
      />
      <DateTimeInput
        id={id("captured_at")}
        type="datetime-local"
        value={draft.capturedAt}
        required={siteSource}
        invalid={invalid.captured}
        onChange={(e) => update({ capturedAt: e.target.value })}
      />
    </div>
  );

  const titleField = (
    <div className="space-y-1.5">
      <FieldLabel {...SOURCE_FIELDS.title} htmlFor={id("title")} />
      <Input
        id={id("title")}
        // Named apart from the event's Title field and the other editors' titles.
        aria-label={`${name} title`}
        value={draft.title}
        maxLength={SOURCE_TITLE_MAX_LEN}
        onChange={(e) => update({ title: e.target.value })}
        placeholder={
          siteSource ? "For example Sentinel-2 true colour" : "For example Drone footage of the strike"
        }
      />
    </div>
  );

  const kindField = (
    <div className="space-y-1.5">
      <FieldLabel {...SOURCE_FIELDS.kind} htmlFor={id("kind")} />
      <OptionSearch
        single
        id={id("kind")}
        aria-label={`${name} kind`}
        placeholder="Search source kinds"
        options={KIND_OPTIONS}
        selected={draft.kind ? [draft.kind] : []}
        onChange={(next) => update({ kind: (next[0] ?? "") as SourceKind | "" })}
      />
    </div>
  );

  const links = (
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
            siteSource ? "https://browser.dataspace.copernicus.eu/?…" : "https://t.me/channel/12345"
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
            ...(showPosted
              ? [
                  {
                    header: `${SOURCE_FIELDS.posted.label} (UTC)`,
                    width: "13rem",
                    cell: ({ index: i, row, update: updateLink }: LinkListRow<LinkDraft>) => (
                      <DateTimeInput
                        type="datetime-local"
                        variant="compact"
                        aria-label={`${SOURCE_FIELDS.posted.label} (UTC), ${describe(i, row.url)}`}
                        title="When the file was posted at this link (UTC)"
                        value={row.postedAt}
                        onChange={(e) => updateLink({ ...row, postedAt: e.target.value })}
                      />
                    ),
                  },
                ]
              : []),
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
            ...(hasFile || !draft.links.some((link) => isImportableLink(link.url))
              ? []
              : [
                  {
                    header: "Import",
                    width: "auto",
                    cell: ({ index: i, row }: { index: number; row: LinkDraft }) =>
                      isImportableLink(row.url) && (
                        <Button
                          icon
                          variant="ghost"
                          onClick={() => onImportLink({ url: row.url.trim(), index: 0, kinds: [] })}
                          aria-label={`Import the file of ${describe(i, row.url)}`}
                          title="Import file from link"
                        >
                          <Download size={14} />
                        </Button>
                      ),
                  },
                ]),
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
      <SourceImageryCheck draft={draft} />
    </div>
  );

  const captureDetails = (
    <>
      {titleField}

      <div className="space-y-1.5">
        <FieldLabel {...SOURCE_FIELDS.level} />
        <OptionSearch
          single
          required
          aria-label={`${name} level`}
          placeholder="Search levels"
          options={LEVEL_OPTIONS}
          selected={[draft.level]}
          onChange={(next) => {
            if (next[0]) update({ level: next[0] as SourceLevel });
          }}
        />
      </div>

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
        </div>
      )}

      {tags && setTags && (
        <TagsField
          tags={tags}
          setTags={setTags}
          suggested={suggestedTags}
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
    </>
  );

  // The disclosure at the foot of the card. Hidden rather than unmounted, so a field inside keeps
  // what it holds.
  const foot = (
    <div className="space-y-4">
      <SectionEyebrow
        as="h3"
        margin="none"
        title={siteSource ? "Title and note" : "Capture details"}
        toggle={{
          open: footOpen,
          onToggle: () => setFootOpen((open) => !open),
          controls: id("details"),
        }}
      />
      <div id={id("details")} hidden={!footOpen} className="space-y-4">
        {siteSource ? (
          <>
            {titleField}
            {extra}
          </>
        ) : (
          captureDetails
        )}
      </div>
    </div>
  );

  return (
    <Card as="section" aria-label={name} dense className="@container">
      <SourceHeader name={name} actions={actions} />
      {/* A lone editor reads like the event page's lone source: once the card is 42rem wide the
          file sits left of the kind (the capture time on a site source), 3:2
          (`DetailCard leadBeside`), and the links and the foot take the card's width under both,
          so a link keeps its one-row layout; narrower, everything stacks. */}
      <div className={cn("grid gap-4", wide && cn(LEAD_BESIDE_SPLIT, "@2xl:gap-x-5"))}>
        {fileSlot}
        <div className="space-y-4">
          {siteSource ? captured : kindField}
        </div>
        <div className={cn("space-y-4", wide && "@2xl:col-span-2")}>
          {links}
          {foot}
        </div>
      </div>
    </Card>
  );
}
