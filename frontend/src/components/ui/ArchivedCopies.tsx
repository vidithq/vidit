"use client";

import { ArchiveRestore, ExternalLink } from "lucide-react";

import type { ArchivedLink } from "@/types";
import { parseHttp } from "@/lib/format";
import { ACTION_ICONS, ActionIcon, Button, buttonClasses } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { OutboundLink } from "@/components/ui/OutboundLink";
import { Tooltip } from "@/components/ui/Tooltip";
import { WARNING_CALLOUT } from "@/components/ui/styles";
import {
  GHOSTARCHIVE_HOST,
  SNAPSHOT_HOSTS,
  snapshotArchivesAnotherLink,
  snapshotProvider,
  WAYBACK_HOST,
} from "@/lib/snapshots";
import { SOURCE_URL_MAX_LEN, sourceName } from "@/lib/sources";
import { FieldError } from "./ErrorNotice";

interface ArchivedCopiesProps {
  copy: ArchivedLink | null;
  /** What the copy is of, folded into each accessible name ("source 1, t.me",
   *  "source 2, link 3, x.com"). Build it with `linkDescription`. */
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
const ArchiveMark = ACTION_ICONS.archive;

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

/** The three services behind those hosts, short enough for the placeholder. */
const SNAPSHOT_SERVICES = [WAYBACK_HOST, "archive.today", GHOSTARCHIVE_HOST];

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
 * Whether a pasted value can be a snapshot: within `SOURCE_URL_MAX_LEN` UTF-8
 * bytes, `https`, on an archive host. The first three checks of
 * `source_archive.validate_snapshot`; the per-provider path shapes stay server
 * side, so true can still be a 400.
 */
export function isSnapshotUrl(value: string): boolean {
  const trimmed = value.trim();
  if (new TextEncoder().encode(trimmed).length > SOURCE_URL_MAX_LEN) return false;
  try {
    const parsed = new URL(trimmed);
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
  return parseHttp(url.trim()) ? url.trim() : null;
}

/**
 * The archived copy beside an outbound source link: a ghost icon button, accent
 * where a copy exists and opens it, grey and inert where none does.
 *
 * Read only. Recording a copy is an edit (`ArchiveBox`,
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

function copyLabel(provider: ArchivedLink["provider"], describes: string): string {
  // An unknown provider is still a stored copy: name it generically.
  const name: string | undefined = PROVIDER_LABELS[provider];
  return name ? `${name} copy of ${describes}` : `Archived copy of ${describes}`;
}

function ArchivedCopyLink({ copy, describes }: { copy: ArchivedLink; describes: string }) {
  const label = copyLabel(copy.provider, describes);
  return (
    <Tooltip label={label}>
      <OutboundLink
        href={copy.url}
        aria-label={label}
        className={buttonClasses("ghost", { icon: true })}
      >
        <ArchiveMark size={14} />
      </OutboundLink>
    </Tooltip>
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

// On the wide list (`@xl` of the `LinkListInput` container) one width in every state, so a copy
// appearing mid typing never narrows the row's other fields; a long service name truncates, and
// its tooltip carries it whole. A narrow list's card wraps its second line instead.
const ARCHIVE_BOX = "flex min-w-0 items-center gap-0.5 @xl:w-36";

/**
 * One link's archive box on a form, in the link's row. Never grey on a form.
 *
 * No copy: the **Archive** icon button (tooltip *Archive*) opens the paste line under the row. A copy (the stored
 * one, or a pasted snapshot on an allowed host): the copy itself, named for its
 * service, plus the `ArchiveRestore` mark, which opens the paste line to replace
 * a wrong paste.
 *
 * Nothing is written here: the pasted value travels with the form and lands in
 * the same write as the event.
 */
export function ArchiveBox({
  describes,
  snapshot,
  expanded,
  onToggle,
}: {
  describes: string;
  /** What the form posts as the link's `snapshot_url`. */
  snapshot: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const pasted = snapshot.trim();
  const provider = isSnapshotUrl(pasted) ? snapshotProvider(pasted) : null;
  if (!provider) {
    return (
      <span className={ARCHIVE_BOX}>
        <Button
          icon
          variant="ghost"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={`Archive ${describes}`}
          title="Archive"
        >
          <ArchiveRestore size={14} />
        </Button>
      </span>
    );
  }
  const replace = `Replace the archived copy of ${describes}`;
  return (
    <span className={ARCHIVE_BOX}>
      <Tooltip label={PROVIDER_LABELS[provider]}>
        <OutboundLink
          href={pasted}
          aria-label={copyLabel(provider, describes)}
          className={buttonClasses("ghost", { className: "min-w-0" })}
        >
          <ActionIcon action="archive" />
          <span className="truncate">{PROVIDER_LABELS[provider]}</span>
        </OutboundLink>
      </Tooltip>
      <Button
        icon
        variant="ghost"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={replace}
        title={replace}
      >
        <ArchiveRestore size={14} />
      </Button>
    </span>
  );
}

/**
 * The paste line `ArchiveBox` opens: one field plus the prefilled provider page.
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
        maxLength={SOURCE_URL_MAX_LEN}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={SNAPSHOT_PLACEHOLDER}
        invalid={invalid}
        trailing={<SavePageDoor target={target} describes={describes} />}
      />
      {invalid && <FieldError>{SNAPSHOT_HINT}</FieldError>}
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
    <Tooltip label={label}>
      <OutboundLink
        href={savePageUrl(target)}
        aria-label={label}
        className={buttonClasses("ghost", { icon: true })}
      >
        <ExternalLink size={14} />
      </OutboundLink>
    </Tooltip>
  );
}

/**
 * One link's `describes` value: its source's position, the link's position when the source
 * holds more than one, and its host, since two links can share a host. A URL with no
 * parseable host falls back to a literal.
 */
export function linkDescription(
  source: number | string,
  hostname: string,
  linkIndex: number,
  linkCount: number
): string {
  const parts = [typeof source === "string" ? source : sourceName(source).toLowerCase()];
  if (linkCount > 1) parts.push(`link ${linkIndex + 1}`);
  parts.push(hostname.trim() || "this link");
  return parts.join(", ");
}
