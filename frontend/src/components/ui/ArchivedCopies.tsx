"use client";

import { useId } from "react";
import { Archive } from "lucide-react";

import type { ArchivedLink } from "@/types";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { Glyph } from "@/components/ui/Glyph";
import { Input } from "@/components/ui/Input";
import { FORM_LABEL } from "@/components/ui/form-styles";
import { TEXT_LINK } from "@/components/ui/styles";

interface ArchivedCopiesProps {
  /** The link's archived copy, or null while it has none. */
  copy: ArchivedLink | null;
  /** What the copy is of, folded into each accessible name ("the source",
   *  "mirror 2, t.me"). A page carries several of these and every glyph in them
   *  looks alike, so each one is named for what it points at. Build a mirror's
   *  value with `mirrorDescription`, which keeps two mirrors on one host
   *  tellable apart. */
  describes: string;
  /** Set false where a caller renders several of these in one list and hoists
   *  the `?` to the section instead, so the explanation appears once rather
   *  than on every row (the Secondary sources list). */
  help?: boolean;
}

/**
 * How a stored copy announces the service that holds it: a name and nothing
 * else.
 *
 * Archiving has one mark on this page whatever produced the copy
 * (`ArchiveMark`), so the service's identity travels in the accessible name
 * rather than in a shape, and their own logos are trademarks and are never
 * drawn. Keyed by the provider union, so a provider the API adds is a build
 * error here rather than a copy with no name.
 *
 * Both entries stay whatever the affordance opens: the field takes a snapshot
 * from any of the three allowed hosts, so a stored archive.today copy has to
 * render under its own name.
 */
const PROVIDER_LABELS: Record<ArchivedLink["provider"], string> = {
  wayback: "Wayback Machine",
  archive_today: "archive.today",
};

/**
 * The one mark for an archived copy, in every state and for every provider.
 *
 * lucide's `Archive` over its `History`: at the 13px this renders at, the box's
 * two blocks stay legible where a clock face and its arrow collapse into a
 * smudge, and a clock reads as "recent" or "version history" rather than "a
 * stored copy".
 *
 * The shape is fixed so that a reader meeting it on the source row and again on
 * the provenance row reads one concept, not two. What varies is state, carried
 * in colour and interactivity, and provider, carried in the accessible name.
 */
const ArchiveMark = Archive;

/** The name the one prefilled link opens under: the service that holds the copy
 *  it produces, so the link and the copy it yields read as one thing. */
const SAVE_PAGE_LABEL = PROVIDER_LABELS.wayback;

/** The host that link archives on, and the first of the accepted three. */
const SAVE_PAGE_HOST = "web.archive.org";

/**
 * The one provider page the affordance opens, prefilled with the link.
 *
 * The Wayback Machine rather than archive.today, on two grounds: Save Page Now
 * works from a browser and mints a replay URL that embeds the link it captured,
 * which is what lets `source_archive.validate_snapshot` check the paste against
 * the link it claims to archive, while an archive.today code embeds nothing and
 * the server must not fetch it to find out; and archive.today throttles or
 * blocks bursts. The link carries the URL as a path segment, where `encodeURI`
 * keeps the scheme separator readable.
 *
 * One door, not one accepted provider: an analyst who prefers archive.today
 * goes there themselves and pastes the result into the same field.
 */
function savePageUrl(url: string): string {
  return `https://${SAVE_PAGE_HOST}/save/${encodeURI(url)}`;
}

/** Every host a snapshot may live on. Mirrors the keys of `PROVIDER_HOSTS` in
 *  `services/source_archive.py`; change it with its backend counterpart. */
export const SNAPSHOT_HOSTS = [SAVE_PAGE_HOST, "archive.ph", "archive.today"];

/** "a, b or c", so every sentence naming the hosts reads them off
 *  `SNAPSHOT_HOSTS` instead of spelling them out again. */
function hostList(hosts: readonly string[]): string {
  const rest = hosts.slice(0, -1).join(", ");
  const last = hosts.slice(-1).join("");
  return rest ? `${rest} or ${last}` : last;
}

/** Said beside the one link and in every state of the form field, so a single
 *  door never reads as a single accepted provider. */
const OTHER_PROVIDERS_HINT = `or paste a snapshot from ${hostList(
  SNAPSHOT_HOSTS.filter((host) => host !== SAVE_PAGE_HOST)
)}`;

/** What the paste field shows while it is empty: the shape the link above
 *  produces, which is what most pastes will be. */
const SNAPSHOT_PLACEHOLDER = `https://${SAVE_PAGE_HOST}/web/…`;

/** What a snapshot link looks like, said once: the field's own hint under the
 *  input, and the banner a form shows when it refuses to publish a paste that
 *  cannot be one. */
export const SNAPSHOT_HINT = `A snapshot link is an https link on ${hostList(SNAPSHOT_HOSTS)}.`;

/**
 * Whether a pasted value can be a snapshot at all: `https` on one of the three
 * archive hosts.
 *
 * The first two checks of `source_archive.validate_snapshot`, run here so a
 * typo costs no round-trip. Deliberately no further: whether a Wayback replay
 * URL embeds *this* link, and whether an archive.today path is a snapshot code,
 * stay server side, where the stored source URL is what the snapshot is
 * compared against. A value this returns true for can still be a 400.
 */
export function isSnapshotUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return (
      parsed.protocol === "https:" && SNAPSHOT_HOSTS.includes(parsed.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

/** The link the provider page can be opened for, or null while the source
 *  field holds nothing usable. `http(s)` only, matching what the catalog will
 *  accept as a source, so the link appears exactly when it would work. */
function archivable(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url.trim() : null;
  } catch {
    return null;
  }
}

/** The provider page prefilled with the link, and the sentence saying the field
 *  below takes a snapshot from any allowed host. Shared by the popover on a
 *  live event and the field on the submit / edit forms, so "archive it
 *  yourself" is the same one link wherever it appears. Wraps to two lines in
 *  the popover's width and sits on one in the form.
 *
 *  A null `url` is a source field holding nothing archivable yet: the link is
 *  replaced by what to do first, and the sentence stays, so the three accepted
 *  hosts are readable in every state rather than only once a link exists. */
function SavePageLink({ url, hintId }: { url: string | null; hintId?: string }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
      {url ? (
        <a
          href={savePageUrl(url)}
          target="_blank"
          rel="noopener noreferrer"
          className={TEXT_LINK}
        >
          Open {SAVE_PAGE_LABEL}
        </a>
      ) : (
        <span className="text-neutral-500">
          Fill in the source URL above to archive it.
        </span>
      )}
      <span id={hintId} className="text-neutral-500">
        {OTHER_PROVIDERS_HINT}
      </span>
    </span>
  );
}

/**
 * The archived copy beside an outbound source link.
 *
 * Sits next to the original rather than replacing it: the original stays the
 * primary link while it resolves, and the copy is one click away the day it
 * stops. One copy per link, from whichever service the analyst used, so the
 * affordance is a single glyph in exactly two states, and colour says which:
 * accent where a copy exists and the mark opens it, grey and inert where none
 * does, for every reader including the event's owner.
 *
 * A read surface, not a write one. Recording a copy is an edit like any other:
 * the owner pastes the snapshot into the edit form's archived-copy field
 * (`ArchiveSourceField`), which files a revision naming the change, where a
 * control here would write to the live row from a page nobody is editing.
 *
 * The glyph is a small mark with no label beside it, so the affordance closes
 * on a `?`: the glyph's accessible name carries its own state for a screen
 * reader, and the `archived_copies` concept explains it to a sighted one. One
 * `?` per group, never one per glyph.
 *
 * One component for the primary source, the provenance link and every secondary
 * mirror, so the same fact cannot grow two affordances.
 */
export function ArchivedCopies({ copy, describes, help = true }: ArchivedCopiesProps) {
  return (
    <span className="ml-2 inline-flex shrink-0 items-center gap-1 align-middle">
      {copy ? (
        <ArchivedGlyph copy={copy} describes={describes} />
      ) : (
        <MissingGlyph describes={describes} />
      )}
      {help && <FieldHelp concept="archived_copies" size={12} />}
    </span>
  );
}

/** The copy that exists: the accent mark opening it, named for its service. */
function ArchivedGlyph({ copy, describes }: { copy: ArchivedLink; describes: string }) {
  // A provider the client does not know is still a stored copy, so it is named
  // generically rather than rendering as no copy at all.
  const provider: string | undefined = PROVIDER_LABELS[copy.provider];
  const label = provider ? `${provider} copy of ${describes}` : `Archived copy of ${describes}`;
  return <Glyph icon={ArchiveMark} label={label} href={copy.url} />;
}

/** No copy, and nothing the viewer can do about it: the same mark, with neither
 *  a target nor an action, which is what paints it grey. */
function MissingGlyph({ describes }: { describes: string }) {
  return <Glyph icon={ArchiveMark} label={`No archived copy of ${describes}`} />;
}

/**
 * The archival affordance on the submit and edit forms: archive the source you
 * just typed, paste the snapshot, publish both together.
 *
 * The same provider link and paste field as the popover on a live event, minus
 * its mutation: nothing is written until the form is submitted, so the value
 * travels with the event as `source_snapshot_url` and lands in the same write.
 * That is what lets an analyst archive a source while it is still in front of
 * them, rather than after the event exists.
 *
 * Optional, and shaped to read that way: no required marker, no readiness
 * entry, and while the source field holds nothing usable the link is replaced
 * by one line saying what to do first, so an empty source URL never presents a
 * dead link. The sentence naming the other accepted hosts sits beside both, and
 * describes the paste field, so an analyst who archives at archive.today reads
 * the contract before typing a source at all. The link recomputes from the
 * current field value, so archiving a corrected URL is a re-click, not a
 * reload.
 *
 * `copy` is the copy the event already carries (the edit form): it renders as
 * the same accent glyph the detail page shows, and the field below it replaces
 * it, since one link holds one copy.
 */
export function ArchiveSourceField({
  sourceUrl,
  value,
  onChange,
  copy = null,
}: {
  /** The Source URL field's current value, which is what gets archived. */
  sourceUrl: string;
  /** The pasted snapshot URL, posted with the form. */
  value: string;
  onChange: (value: string) => void;
  /** The copy the event already carries, on the edit form. */
  copy?: ArchivedLink | null;
}) {
  const fieldId = useId();
  // The hosts the field takes are the paste field's own description, so a
  // screen reader hears them on focus rather than only where the sentence sits.
  const hintId = useId();
  const target = archivable(sourceUrl);
  const pasted = value.trim();
  // Flagged only once something is typed: an empty field is the ordinary state
  // of an optional one, not a mistake.
  const invalid = pasted !== "" && !isSnapshotUrl(pasted);

  return (
    <div className="space-y-1.5">
      <label className={FORM_LABEL} htmlFor={fieldId}>
        Archived copy <FieldHelp concept="archived_copies" />
        <span className="ml-1.5 text-[10px] normal-case tracking-normal text-neutral-500">
          optional
        </span>
      </label>
      {copy && (
        <p className="flex items-center gap-1.5 text-xs text-neutral-400">
          This source has a copy
          <ArchivedGlyph copy={copy} describes={PRIMARY_SOURCE_DESCRIPTION} />
          <span className="text-neutral-500">paste another to replace it.</span>
        </p>
      )}
      <SavePageLink url={target} hintId={hintId} />
      <Input
        id={fieldId}
        type="url"
        variant="compact"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={SNAPSHOT_PLACEHOLDER}
        invalid={invalid}
        aria-describedby={hintId}
      />
      {invalid && <p className="text-xs text-red-400">{SNAPSHOT_HINT}</p>}
    </div>
  );
}

/** The primary source's own name, kept distinct from every mirror's. */
export const PRIMARY_SOURCE_DESCRIPTION = "the source";

/** The provenance link's name: the post a machine detection came from,
 *  which is not the footage source and must not announce as it. */
export const DETECTED_FROM_DESCRIPTION = "the post it was detected from";

/**
 * One mirror's `describes` value: its host, prefixed by its position whenever
 * the list holds more than one.
 *
 * The host alone is not an identity. Two mirrors of the same channel share it,
 * which leaves two links on the page with one accessible name, and a URL the
 * parser refuses has no host to show at all. The position disambiguates the
 * first case and a literal covers the second, so every archived copy on the
 * page announces something a reader can act on.
 */
export function mirrorDescription(hostname: string, index: number, total: number): string {
  const host = hostname.trim();
  if (total < 2) return host || "this mirror";
  return host ? `mirror ${index + 1}, ${host}` : `mirror ${index + 1}`;
}
