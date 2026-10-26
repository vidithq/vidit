"use client";

import { useState, type ReactNode } from "react";

import { SourceEditor } from "@/components/sources/SourceEditor";
import { sourceDraftUpdaters, sourcesBlockWrite } from "@/components/sources/SourcesField";
import { Button } from "@/components/ui/Button";
import { CharCounter } from "@/components/ui/CharCounter";
import { CountBadge } from "@/components/ui/CountBadge";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { IncompleteFormAnnouncer } from "@/components/ui/IncompleteFormAnnouncer";
import { Textarea } from "@/components/ui/Input";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { missingSummary } from "@/lib/events";
import {
  SITE_IMAGE_NOTE_MAX_LEN,
  newSiteImageDraft,
  siteImageMissing,
  siteImagePayload,
  todayUtc,
} from "@/lib/sites";
import type { SourceDraft } from "@/lib/sources";

/** A site image form's state: the one source draft and the note. */
export function useSiteImageDraft() {
  const [drafts, setDrafts] = useState<SourceDraft[]>(() => [newSiteImageDraft()]);
  const [note, setNote] = useState("");
  const draft = drafts[0];
  return {
    drafts,
    setDrafts,
    note,
    setNote,
    /** What the image still lacks, as labels. */
    missing: siteImageMissing(draft, note, todayUtc()),
    /** A running upload or a refused archived copy, which hold the write. */
    held: sourcesBlockWrite(drafts),
    payload: () => siteImagePayload(draft, note),
  };
}

/**
 * The image of a site form: the event form's source editor in its site image shape (the file,
 * the title, the required capture time, the links with their archive and the imagery provider
 * check), closed by the note. `flagged` turns the fields a write attempt found missing red.
 */
export function SiteImageEditor({
  state,
  flagged,
  name = "Image",
}: {
  state: ReturnType<typeof useSiteImageDraft>;
  flagged: boolean;
  name?: string;
}) {
  const { drafts, setDrafts, note, setNote } = state;
  const draft = drafts[0];
  const { update, pickFile, importLink } = sourceDraftUpdaters(setDrafts);
  const noteTooLong = note.length > SITE_IMAGE_NOTE_MAX_LEN;
  return (
    <SourceEditor
      draft={draft}
      index={0}
      name={name}
      variant="site-image"
      wide
      update={update(draft.key)}
      onPickFile={(file) => void pickFile(draft.key)(file)}
      onImportLink={(post) => void importLink(draft.key)(post)}
      invalid={{
        captured: flagged && !draft.capturedAt,
        link: flagged && draft.links.every((l) => !l.url.trim()),
      }}
      extra={
        <div className="space-y-1.5">
          <FieldLabel
            label="Note"
            concept="site_image_note"
            htmlFor={`${draft.key}-note`}
            invalid={noteTooLong}
            trailing={<CharCounter length={note.length} max={SITE_IMAGE_NOTE_MAX_LEN} />}
          />
          <Textarea
            id={`${draft.key}-note`}
            rows={3}
            value={note}
            invalid={noteTooLong}
            onChange={(e) => setNote(e.target.value)}
            placeholder="For example Two new sheds south of the berm."
          />
        </div>
      }
    />
  );
}

/**
 * The pinned write of a site form, like an event form's: the button with a `CountBadge` of what
 * the write still lacks, a hidden announcer, and the error banner under it.
 */
export function SiteWriteActions({
  label,
  busyLabel,
  icon,
  missing,
  attempt,
  busy,
  error,
  onWrite,
}: {
  label: string;
  busyLabel: string;
  icon: ReactNode;
  missing: string[];
  attempt: number;
  busy: boolean;
  error: string | null;
  onWrite: () => void;
}) {
  return (
    <div className="flex max-w-sm flex-col items-end gap-2">
      <CountBadge count={missing.length} label={missingSummary(missing.map((m) => ({ label: m })))}>
        {(describedBy) => (
          <Button variant="primary" disabled={busy} aria-describedby={describedBy} onClick={onWrite}>
            {icon}
            {busy ? busyLabel : label}
          </Button>
        )}
      </CountBadge>
      <IncompleteFormAnnouncer attempt={attempt} missing={attempt > 0 ? missing : []} />
      {error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
