"use client";

import { Archive, ArchiveRestore, ExternalLink } from "lucide-react";

import type { ArchivedLink } from "@/types";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { WARNING_CALLOUT } from "@/components/ui/styles";
import { ARCHIVE_TODAY_HOSTS, snapshotArchivesAnotherLink, WAYBACK_HOST } from "@/lib/snapshots";

interface ArchivedCopiesProps {
  copy: ArchivedLink | null;
  /** What the copy is of, folded into each accessible name ("the source",
   *  "mirror 2, t.me"). Build a mirror's value with `mirrorDescription`. */
  describes: string;
}

/**
 * The service's name for the accessible label. Logos are trademarks and are
 * never drawn. Keyed by the provider union, so a provider the API adds is a
 * build error here. Every provider needs an entry: the field accepts a snapshot
 * from any allowed host.
 */
const PROVIDER_LABELS: Record<ArchivedLink["provider"], string> = {
  wayback: "Wayback Machine",
  archive_today: "archive.today",
  ghostarchive: "Ghostarchive",
};

/**
 * The one mark for an archived copy, in every state and for every provider.
 * State shows in colour and interactivity, provider in the accessible name.
 */
const ArchiveMark = Archive;

const SAVE_PAGE_LABEL = PROVIDER_LABELS.wayback;

/**
 * The provider page the affordance opens, prefilled with the link.
 *
 * Wayback rather than archive.today: Save Page Now works from a browser and
 * mints a replay URL that names the captured link (which the mis-paste warning
 * reads), and archive.today throttles bursts. Analysts may paste a snapshot
 * from any allowed provider.
 */
function savePageUrl(url: string): string {
  return `https://${WAYBACK_HOST}/save/${encodeURI(url)}`;
}

/** Every host a snapshot may live on. Mirrors the keys of `PROVIDER_HOSTS` in
 *  `services/source_archive.py`; change both. The archive.today domains come
 *  from `lib/snapshots.ts`. */
export const SNAPSHOT_HOSTS = [
  WAYBACK_HOST,
  ...ARCHIVE_TODAY_HOSTS,
  "ghostarchive.org",
];

/** The three services behind those hosts, short enough for the placeholder. */
const SNAPSHOT_SERVICES = [WAYBACK_HOST, "archive.today", "ghostarchive.org"];

function hostList(hosts: readonly string[]): string {
  const rest = hosts.slice(0, -1).join(", ");
  const last = hosts.slice(-1).join("");
  return rest ? `${rest} or ${last}` : last;
}

const SNAPSHOT_PLACEHOLDER = `Paste a snapshot link (${SNAPSHOT_SERVICES.join(", ")})`;

/** The hint under the field and the banner when a form refuses a paste. Lists
 *  every host so a refusal says exactly what parses. */
export const SNAPSHOT_HINT = `A snapshot link is an https link on ${hostList(SNAPSHOT_HOSTS)}.`;

/**
 * Whether a pasted value can be a snapshot: `https` on an archive host.
 * The first two checks of `source_archive.validate_snapshot`; the per-provider
 * path shapes stay server side, so true can still be a 400.
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

/** The link the provider page can open for, or null. `http(s)` only, matching
 *  what the catalog accepts as a source. */
function archivable(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url.trim() : null;
  } catch {
    return null;
  }
}

/**
 * The archived copy beside an outbound source link: a ghost icon button, accent
 * where a copy exists and opens it, grey and inert where none does.
 *
 * Read only. Recording a copy is an edit (`ArchiveAdornment`,
 * `ArchiveSnapshotField`) that files a version.
 *
 * No label or `?` of its own: the accessible name carries the state, and the
 * row's field tooltips explain the mark once.
 *
 * `self-center` and the negative margin keep the 32px control centred on the
 * link's 20px line without growing the row, since the row aligns on the
 * baseline.
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

function ArchivedCopyLink({ copy, describes }: { copy: ArchivedLink; describes: string }) {
  // An unknown provider is still a stored copy: name it generically.
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

function MissingCopyMark({ describes }: { describes: string }) {
  const label = `No archived copy of ${describes}`;
  return (
    <Button icon variant="ghost" disabled aria-label={label} title={label}>
      <ArchiveMark size={14} />
    </Button>
  );
}

/**
 * The archive affordance inside a form's URL field. Never grey on a form.
 *
 * No copy: the `ArchiveRestore` mark opens the paste line. With a copy: the
 * `Archive` mark opens it, plus `ArchiveRestore` to replace a wrong paste.
 *
 * Nothing is written here: the pasted value travels with the form and lands in
 * the same write as the event.
 */
export function ArchiveAdornment({
  describes,
  copy,
  expanded,
  onToggle,
}: {
  describes: string;
  copy: ArchivedLink | null;
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
 * The paste line the mark opens: one field plus the prefilled provider page.
 *
 * No label or hint: the placeholder carries the contract. Accepted hosts read
 * off `SNAPSHOT_HOSTS`.
 *
 * The trailing control opens `https://web.archive.org/save/<link>` for the
 * link as currently typed, and goes grey while that link does not parse.
 *
 * `isSnapshotUrl` runs as the analyst types. A paste that reads as a copy of
 * another link raises an amber, non-blocking warning
 * (`snapshotArchivesAnotherLink`), shown only when the value is not already
 * refused.
 */
export function ArchiveSnapshotField({
  link,
  describes,
  value,
  onChange,
}: {
  link: string;
  describes: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const target = archivable(link);
  const pasted = value.trim();
  // An empty field is not an error.
  const invalid = pasted !== "" && !isSnapshotUrl(pasted);
  const archivesAnother = invalid ? null : snapshotArchivesAnotherLink(link, pasted);

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
      {archivesAnother && (
        <p className={`rounded-md px-2 py-1 text-xs ${WARNING_CALLOUT}`}>
          That snapshot looks like a copy of{" "}
          <span className="break-all">{archivesAnother}</span>, not of{" "}
          <span className="break-all">{link.trim()}</span>. Nothing is blocked: save it if
          that is what you meant.
        </p>
      )}
    </div>
  );
}

/** The provider page for the typed link; disabled while it does not parse. */
function SavePageDoor({
  target,
  describes,
}: {
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

export const PRIMARY_SOURCE_DESCRIPTION = "the source";

/** The post a machine detection came from, not the footage source. */
export const DETECTED_FROM_DESCRIPTION = "the post it was detected from";

/**
 * One mirror's `describes` value: its host, prefixed by position when the list
 * holds more than one, since two mirrors can share a host. A URL with no
 * parseable host falls back to a literal.
 */
export function mirrorDescription(hostname: string, index: number, total: number): string {
  const host = hostname.trim();
  if (total < 2) return host || "this mirror";
  return host ? `mirror ${index + 1}, ${host}` : `mirror ${index + 1}`;
}
