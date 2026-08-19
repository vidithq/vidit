"use client";

import { Archive, ArchiveRestore, ExternalLink } from "lucide-react";

import type { ArchivedLink } from "@/types";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

interface ArchivedCopiesProps {
  /** The link's archived copy, or null while it has none. */
  copy: ArchivedLink | null;
  /** What the copy is of, folded into each accessible name ("the source",
   *  "mirror 2, t.me"). A page carries several of these and every mark in them
   *  looks alike, so each one is named for what it points at. Build a mirror's
   *  value with `mirrorDescription`, which keeps two mirrors on one host
   *  tellable apart. */
  describes: string;
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
 * lucide's `Archive` over its `History`: at the size this renders at, the box's
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

/** What the paste field asks for, and the whole instruction the line carries:
 *  the field has no label and no sentence under it, so the three hosts it takes
 *  are named here. One door is prefilled beside it, which is why the placeholder
 *  states all three rather than the one. */
const SNAPSHOT_PLACEHOLDER = `Paste a snapshot link (${SNAPSHOT_HOSTS.join(", ")})`;

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

/**
 * The archived copy beside an outbound source link.
 *
 * Sits next to the original rather than replacing it: the original stays the
 * primary link while it resolves, and the copy is one click away the day it
 * stops. One copy per link, from whichever service the analyst used, so the
 * affordance is a single ghost icon button in exactly two states, and colour
 * says which: accent where a copy exists and the mark opens it, grey and inert
 * where none does, for every reader including the event's owner.
 *
 * A read surface, not a write one. Recording a copy is an edit like any other:
 * the owner opens the archive mark in the edit form's URL field
 * (`ArchiveAdornment`) and pastes the snapshot into the line it reveals
 * (`ArchiveSnapshotField`), which files a version naming the change, where a
 * control here would write to the live row from a page nobody is editing.
 *
 * The control carries no label beside it and no `?` of its own: its accessible
 * name carries its own state for a screen reader, and the row's field concept
 * explains the mark to a sighted one, so a page listing ten mirrors shows one
 * explanation rather than ten. That is the `source_url`,
 * `secondary_source_urls` and `detected_from` tooltips, each of which describes
 * the archive mark on its own row.
 *
 * `self-center` on the box: the rows it sits in align their text on the
 * baseline, and the icon button's square hung off a baseline sits low against
 * the link it belongs to. The negative margin beside it takes the square back
 * out of the line's height, so the control centres on the link's own line and a
 * row carrying a mark stands as tall as a row without one; the hover plate
 * overhangs into the row's padding, which is what a 32px control needs on a
 * 20px line.
 *
 * One component for the primary source, the provenance link and every secondary
 * mirror, so the same fact cannot grow two affordances.
 */
export function ArchivedCopies({ copy, describes }: ArchivedCopiesProps) {
  return (
    <span className="ml-1 -my-1.5 inline-flex shrink-0 items-center self-center align-middle">
      {copy ? (
        <ArchivedCopyLink copy={copy} describes={describes} />
      ) : (
        <MissingCopyMark describes={describes} />
      )}
    </span>
  );
}

/** The copy that exists: the accent mark opening it, named for its service. */
function ArchivedCopyLink({ copy, describes }: { copy: ArchivedLink; describes: string }) {
  // A provider the client does not know is still a stored copy, so it is named
  // generically rather than rendering as no copy at all.
  const provider: string | undefined = PROVIDER_LABELS[copy.provider];
  const label = provider ? `${provider} copy of ${describes}` : `Archived copy of ${describes}`;
  return (
    <a
      href={copy.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      className={buttonClasses("ghost", { icon: true })}
    >
      <ArchiveMark size={14} />
    </a>
  );
}

/** No copy, and nothing the viewer can do about it: the same mark on a disabled
 *  button, which is what paints it grey and takes it out of the tab order. */
function MissingCopyMark({ describes }: { describes: string }) {
  const label = `No archived copy of ${describes}`;
  return (
    <Button icon variant="ghost" disabled aria-label={label} title={label}>
      <ArchiveMark size={14} />
    </Button>
  );
}

/**
 * The archive affordance a link on a form carries: the mark inside the URL
 * field itself.
 *
 * One mark per link, in the field the link is typed in, so archiving is where
 * the link is rather than in a block under it. On a form the mark is never
 * grey: whatever state the link is in, there is something to do with it.
 *
 * A link with no copy carries the `ArchiveRestore` mark, which opens the paste
 * line under the field. A link that already has one carries the `Archive` mark
 * that opens the stored copy, the same mark and the same name the event page
 * shows, plus the `ArchiveRestore` mark beside it: one link holds one copy, and
 * replacing a wrong paste is the reason the second mark stays.
 *
 * Nothing is written here. The pasted value travels with the form and lands in
 * the same write as the event, which is what lets a link be archived while it
 * is still in front of the analyst rather than after the event exists.
 */
export function ArchiveAdornment({
  describes,
  copy,
  expanded,
  onToggle,
}: {
  /** What the link is, folded into every name here ("the source", "mirror 2,
   *  t.me"): a form carries several of these marks and they look alike. */
  describes: string;
  /** The copy the link already carries, on the edit form. */
  copy: ArchivedLink | null;
  /** Whether the paste line under the field is open. */
  expanded: boolean;
  onToggle: () => void;
}) {
  const label = copy
    ? `Replace the archived copy of ${describes}`
    : `Archive ${describes}`;
  return (
    <>
      {copy && <ArchivedCopyLink copy={copy} describes={describes} />}
      <Button
        icon
        variant="ghost"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={label}
        title={label}
      >
        <ArchiveRestore size={14} />
      </Button>
    </>
  );
}

/**
 * The paste line the mark opens: one field, and the door to the one provider
 * page prefilled with the link it archives.
 *
 * A field and nothing else. It carries no label, no optional marker and no
 * sentence, because the placeholder already says the whole contract (paste a
 * snapshot, from one of these three hosts) and the line only exists while the
 * analyst asked for it. The accepted hosts read off `SNAPSHOT_HOSTS`, so the
 * check and the instruction cannot drift.
 *
 * The trailing control opens `https://web.archive.org/save/<link>` for the value
 * currently typed above, so archiving a corrected URL is a re-click rather than
 * a reload. It is the one state on a form where a control goes grey: a link that
 * does not parse has no page to open yet, and a dead door is worse than an
 * inert one.
 *
 * `isSnapshotUrl` runs as the analyst types, so a typo costs no round trip; the
 * refusal under the field is the same sentence the form's banner carries.
 */
export function ArchiveSnapshotField({
  link,
  describes,
  value,
  onChange,
}: {
  /** The link this field archives, as currently typed in the field above. */
  link: string;
  /** What that link is, for the field's own name and the door's. */
  describes: string;
  /** The pasted snapshot URL, posted with the form. */
  value: string;
  onChange: (value: string) => void;
}) {
  const target = archivable(link);
  const pasted = value.trim();
  // Flagged only once something is typed: an empty field is the ordinary state
  // of an optional one, not a mistake.
  const invalid = pasted !== "" && !isSnapshotUrl(pasted);

  return (
    <div className="space-y-1">
      <Input
        aria-label={`Archived copy of ${describes}`}
        type="url"
        variant="compact"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={SNAPSHOT_PLACEHOLDER}
        invalid={invalid}
        trailing={<SavePageDoor target={target} describes={describes} />}
      />
      {invalid && <p className="text-xs text-red-400">{SNAPSHOT_HINT}</p>}
    </div>
  );
}

/** The provider page for the link as currently typed, and the one control on a
 *  form that goes grey: a link that does not parse has no page to open, so the
 *  door becomes a disabled button naming what to fill in first. */
function SavePageDoor({
  target,
  describes,
}: {
  /** The link to archive, or null while the field above holds nothing usable. */
  target: string | null;
  describes: string;
}) {
  if (!target) {
    const label = `Fill in ${describes} to archive it`;
    return (
      <Button icon variant="ghost" disabled aria-label={label} title={label}>
        <ExternalLink size={14} />
      </Button>
    );
  }
  const label = `Open the ${SAVE_PAGE_LABEL} for ${describes}`;
  return (
    <a
      href={savePageUrl(target)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      className={buttonClasses("ghost", { icon: true })}
    >
      <ExternalLink size={14} />
    </a>
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
