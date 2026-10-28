"use client";

import { useState, type ReactNode } from "react";

import { SourceEditor } from "@/components/sources/SourceEditor";
import { sourceDraftUpdaters, sourcesBlockWrite } from "@/components/sources/SourcesField";
import { Button, type ButtonAction } from "@/components/ui/Button";
import { CharCounter } from "@/components/ui/CharCounter";
import { CountBadge } from "@/components/ui/CountBadge";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { IncompleteFormAnnouncer } from "@/components/ui/IncompleteFormAnnouncer";
import { Textarea } from "@/components/ui/Input";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { missingSummary } from "@/lib/events";
import {
  SITE_SOURCE_NOTE_MAX_LEN,
  newSiteSourceDraft,
  siteSourceMissing,
  siteSourcePayload,
  todayUtc,
} from "@/lib/sites";
import type { SourceDraft } from "@/lib/sources";

/** A site source form's state: the one source draft and the note. */
export function useSiteSourceDraft() {
  const [drafts, setDrafts] = useState<SourceDraft[]>(() => [newSiteSourceDraft()]);
  const [note, setNote] = useState("");
  const draft = drafts[0];
  return {
    drafts,
    setDrafts,
    note,
    setNote,
    /** What the source still lacks, as labels. */
    missing: siteSourceMissing(draft, note, todayUtc()),
    /** A running upload or a refused archived copy, which hold the write. */
    held: sourcesBlockWrite(drafts),
    payload: () => siteSourcePayload(draft, note),
  };
}

/**
 * The source of a site form: the event form's source editor in its site source shape (the file,
 * the title, the required capture time, the links with their archive and the imagery provider
 * check), closed by the note. `flagged` turns the fields a write attempt found missing red.
 */
export function SiteSourceEditor({
  state,
  flagged,
  name,
  actions,
}: {
  state: ReturnType<typeof useSiteSourceDraft>;
  flagged: boolean;
  /** The card's heading: *Source N*, numbered after the site's sources. */
  name: string;
  /** Controls in the card's header (an edit form's discard). */
  actions?: ReactNode;
}) {
  const { drafts, setDrafts, note, setNote } = state;
  const draft = drafts[0];
  const { update, pickFile, importLink } = sourceDraftUpdaters(setDrafts, 1);
  const noteTooLong = note.length > SITE_SOURCE_NOTE_MAX_LEN;
  return (
    <SourceEditor
      draft={draft}
      index={0}
      name={name}
      variant="site-source"
      wide
      actions={actions}
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
            concept="site_source_note"
            htmlFor={`${draft.key}-note`}
            invalid={noteTooLong}
            trailing={<CharCounter length={note.length} max={SITE_SOURCE_NOTE_MAX_LEN} />}
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
  action,
  missing,
  attempt,
  busy,
  error,
  onWrite,
}: {
  label: string;
  busyLabel: string;
  action: ButtonAction;
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
          <Button
            action={action}
            variant="primary"
            disabled={busy}
            aria-describedby={describedBy}
            onClick={onWrite}
          >
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
