"use client";

import { useId, useState } from "react";
import { Archive, History } from "lucide-react";

import type { ArchivedLink } from "@/types";
import { recordArchivedCopy } from "@/lib/events";
import { useMutation } from "@/hooks/useMutation";
import { Button } from "@/components/ui/Button";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { Input } from "@/components/ui/Input";
import { FORM_ERROR_BANNER, FORM_LABEL_COMPACT } from "@/components/ui/form-styles";
import { TEXT_LINK } from "@/components/ui/styles";

interface ArchivedCopiesProps {
  /** The link's archived copy, or null while it has none. */
  copy: ArchivedLink | null;
  /** The link itself: what the provider pages are prefilled with, and what the
   *  recorded copy is filed under. */
  url: string;
  /** Which event the link belongs to. The write endpoint is per event. */
  eventId: string;
  /** What the copy is of, folded into each accessible name ("the source",
   *  "mirror 2, t.me"). A page carries several of these and every glyph in them
   *  looks alike, so each one is named for what it points at. Build a mirror's
   *  value with `mirrorDescription`, which keeps two mirrors on one host
   *  tellable apart. */
  describes: string;
  /** Whether the viewer may record a copy, which is exactly whether they own
   *  the event. False leaves the glyph inert: a reader sees that no copy exists
   *  without being offered an action the server would refuse. */
  canArchive: boolean;
  /** Set false where a caller renders several of these in one list and hoists
   *  the `?` to the section instead, so the explanation appears once rather
   *  than on every row (the Secondary sources list). */
  help?: boolean;
}

/** How a provider's own submit page is opened, prefilled with the link. */
interface ProviderSpec {
  key: ArchivedLink["provider"];
  /** The service's name, as it is announced. */
  label: string;
  Glyph: typeof History;
  /** The provider page that archives `url`, opened in the analyst's own tab. */
  submitUrl: (url: string) => string;
}

/**
 * The two services, in the order they read. Distinguishable glyphs rather than
 * the services' own marks: a logo is a trademark, and a clock-with-arrow for
 * the Wayback Machine's history replay against a box for archive.today's
 * snapshot tells them apart on their own. The name is what carries the
 * identity, in the accessible name.
 *
 * `submitUrl` encodes to match each form: the Wayback save page carries the
 * link as a path, where `encodeURI` keeps the scheme separator readable, and
 * archive.today carries it as a query parameter, where every reserved
 * character has to be escaped.
 */
const PROVIDERS: readonly ProviderSpec[] = [
  {
    key: "wayback",
    label: "Wayback Machine",
    Glyph: History,
    submitUrl: (url) => `https://web.archive.org/save/${encodeURI(url)}`,
  },
  {
    key: "archive_today",
    label: "archive.today",
    Glyph: Archive,
    submitUrl: (url) => `https://archive.ph/?url=${encodeURIComponent(url)}`,
  },
];

const PROVIDER_BY_KEY = new Map(PROVIDERS.map((p) => [p.key, p]));

/**
 * The archived copy beside an outbound source link, and the way its owner makes
 * one.
 *
 * Sits next to the original rather than replacing it: the original stays the
 * primary link while it resolves, and the copy is one click away the day it
 * stops. One copy per link, from whichever service the analyst used, so the
 * affordance is a single glyph: accent and clickable once a copy exists, grey
 * while none does.
 *
 * Archiving is an act the analyst performs, not something the server attempts.
 * Both services refuse or throttle server-side submissions of exactly the hosts
 * this catalog cites, and both work from a browser, so the grey glyph opens the
 * two provider pages prefilled with the link and takes the snapshot URL back in
 * one field. A viewer who does not own the event sees the grey glyph inert.
 *
 * The glyph is a small mark with no label beside it, so the affordance closes
 * on a `?`: the glyph's accessible name carries its own state for a screen
 * reader, and the `archived_copies` concept explains it to a sighted one. One
 * `?` per group, never one per glyph.
 *
 * One component for the primary source, the provenance link and every secondary
 * mirror, so the same fact cannot grow two affordances.
 */
export function ArchivedCopies({
  copy,
  url,
  eventId,
  describes,
  canArchive,
  help = true,
}: ArchivedCopiesProps) {
  // What the paste recorded, which outranks the payload the page was rendered
  // with: the copy has to appear the moment it is saved, and the page's own
  // data is a fetch old by then.
  const [recorded, setRecorded] = useState<ArchivedLink | null>(null);
  const [open, setOpen] = useState(false);
  const current = recorded ?? copy;

  return (
    <span className="ml-2 inline-flex shrink-0 items-center gap-1 align-middle">
      {current ? (
        <ArchivedGlyph copy={current} describes={describes} />
      ) : canArchive ? (
        <ArchiveAction
          url={url}
          eventId={eventId}
          describes={describes}
          open={open}
          setOpen={setOpen}
          onRecorded={setRecorded}
        />
      ) : (
        <MissingGlyph describes={describes} />
      )}
      {help && <FieldHelp concept="archived_copies" size={12} />}
    </span>
  );
}

/** The copy that exists: one accent glyph opening it, marked with its service. */
function ArchivedGlyph({ copy, describes }: { copy: ArchivedLink; describes: string }) {
  // A provider the client does not know is still a stored copy, so it opens
  // under the generic archive mark rather than rendering as no copy at all.
  const spec = PROVIDER_BY_KEY.get(copy.provider);
  const Glyph = spec?.Glyph ?? Archive;
  const label = spec ? `${spec.label} copy of ${describes}` : `Archived copy of ${describes}`;
  return (
    <a
      href={copy.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className={`${TEXT_LINK} inline-flex`}
    >
      <Glyph size={13} aria-hidden />
    </a>
  );
}

/** No copy, and nothing the viewer can do about it. */
function MissingGlyph({ describes }: { describes: string }) {
  return (
    <span
      role="img"
      aria-label={`No archived copy of ${describes}`}
      className="inline-flex text-neutral-600"
    >
      <Archive size={13} aria-hidden />
    </span>
  );
}

/**
 * The owner's path from no copy to one: open a provider, paste what it gives
 * back.
 *
 * Collapsed to the same grey glyph a reader sees, so an unarchived link reads
 * identically whoever is looking at it until they ask for the action. Expanded,
 * the two provider links carry the URL already filled in, so the analyst never
 * copies it by hand, and the field beside them is where the snapshot returns.
 */
function ArchiveAction({
  url,
  eventId,
  describes,
  open,
  setOpen,
  onRecorded,
}: {
  url: string;
  eventId: string;
  describes: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  onRecorded: (copy: ArchivedLink) => void;
}) {
  const [snapshot, setSnapshot] = useState("");
  // Generated rather than derived from the URL: several of these sit on one
  // page, and a link is not a legal id.
  const fieldId = useId();
  const save = useMutation(recordArchivedCopy, {
    fallback: "Could not save that link.",
    onSuccess: onRecorded,
  });

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={`Archive ${describes}`}
        className="inline-flex text-neutral-600 hover:text-neutral-300 transition-colors"
      >
        <Archive size={13} aria-hidden />
      </button>
      {open && (
        <span className="absolute right-0 top-5 z-20 flex w-64 flex-col gap-2 rounded-md border border-neutral-800 bg-neutral-900 p-3 text-left shadow-lg">
          <span className={FORM_LABEL_COMPACT}>Archive it yourself</span>
          {PROVIDERS.map(({ key, label, submitUrl }) => (
            <a
              key={key}
              href={submitUrl(url)}
              target="_blank"
              rel="noopener noreferrer"
              className={`text-xs ${TEXT_LINK}`}
            >
              Open {label}
            </a>
          ))}
          <label className={FORM_LABEL_COMPACT} htmlFor={fieldId}>
            Paste the snapshot link
          </label>
          <Input
            id={fieldId}
            variant="compact"
            value={snapshot}
            onChange={(e) => setSnapshot(e.target.value)}
            placeholder="https://archive.ph/…"
          />
          {save.error && <span className={FORM_ERROR_BANNER}>{save.error}</span>}
          <Button
            variant="secondary"
            disabled={save.loading || !snapshot.trim()}
            onClick={() => void save.run(eventId, url, snapshot.trim())}
          >
            {save.loading ? "Saving…" : "Save"}
          </Button>
        </span>
      )}
    </span>
  );
}

/** The primary source's own name, kept distinct from every mirror's. */
export const PRIMARY_SOURCE_DESCRIPTION = "the source";

/** The provenance link's name: the post a machine draft was detected from,
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
