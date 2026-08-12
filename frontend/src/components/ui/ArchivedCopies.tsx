import { Archive, History } from "lucide-react";

import type { ArchivedCopies as ArchivedCopiesPayload } from "@/types";
import { TEXT_LINK } from "@/components/ui/styles";

interface ArchivedCopiesProps {
  /** The link's archival record. Null on a link the queue does not track (a
   *  source-less row, an unpublished draft): the component renders nothing, so
   *  callers hand it the field straight off the payload without their own
   *  guard. */
  copies: ArchivedCopiesPayload | null;
  /** What the copies are of, folded into each accessible name ("the source",
   *  "mirror 2, t.me"). A page carries several of these pairs and every glyph
   *  in them looks alike, so each one is named for what it points at. Build a
   *  mirror's value with `mirrorDescription`, which keeps two mirrors on one
   *  host tellable apart. */
  describes: string;
  /** Render the pair as the promise a draft's links carry: greyed, inert, and
   *  named "archived when published".
   *
   *  A draft has no queue rows at all by design, publication being the trigger,
   *  so its `copies` are null and the pair would otherwise be nothing at all on
   *  a surface where every published event shows one. The caller reads it off
   *  the event's status; it is never inferred from payload the queue did not
   *  write. */
  pendingPublication?: boolean;
}

/**
 * How one provider's copy stands, which is what decides its glyph.
 *
 * `unpublished` is the draft state: no capture has been attempted because none
 * is due yet. It comes from the event's status rather than from the record, so
 * it sits alongside the four the record itself can express.
 */
type CopyState = "captured" | "missing" | "failed" | "pending" | "unpublished";

interface ProviderSpec {
  key: "wayback" | "archive_today";
  /** The service's name, as it is announced and shown in the tooltip. */
  label: string;
  Glyph: typeof History;
}

/**
 * The two providers, in the order they read. Distinguishable glyphs rather
 * than the services' own marks: a logo is a trademark, and a clock-with-arrow
 * for the Wayback Machine's history replay against a box for archive.today's
 * snapshot tells them apart on their own. The name is what carries the
 * identity, in the tooltip and the accessible name.
 */
const PROVIDERS: readonly ProviderSpec[] = [
  { key: "wayback", label: "Wayback Machine", Glyph: History },
  { key: "archive_today", label: "archive.today", Glyph: Archive },
];

/**
 * The archived copies beside an outbound source link: one icon per archiving
 * service, accent and clickable where that service holds a copy, greyed and
 * inert where it does not.
 *
 * Sits next to the original rather than replacing it: the original stays the
 * primary link while it resolves, and a copy is one click away the day it
 * stops. Absence is shown rather than hidden, so a reader can tell a copy that
 * is still coming from one that is never coming: greyed glyphs with an "in
 * progress" name while the queue is still trying, with an "archiving failed"
 * name once both services have given up for good, and with an "archived when
 * published" name on a draft, whose links are queued at publication.
 *
 * Every glyph carries a `title` as well as its accessible name, so a sighted
 * reader gets the same fact on hover that a screen reader is given: the icons
 * are small marks with no label beside them.
 *
 * One component for the primary source, the provenance link and every
 * secondary mirror, so the same fact cannot grow two affordances.
 */
export function ArchivedCopies({
  copies,
  describes,
  pendingPublication = false,
}: ArchivedCopiesProps) {
  if (!copies && !pendingPublication) return null;
  return (
    <span className="ml-2 inline-flex shrink-0 items-center gap-1 align-middle">
      {PROVIDERS.map(({ key, label, Glyph }) => {
        const href = copies?.[key] ?? null;
        // A record, wherever one exists, outranks the promise: the flag only
        // decides what an *absent* record renders, so a link the queue has
        // already answered for never reads as "archived when published".
        const state: CopyState = copies ? copyState(copies, href) : "unpublished";
        const name = accessibleName(label, describes, state);
        if (href) {
          return (
            <a
              key={key}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              title={`${label} copy`}
              aria-label={name}
              className={`${TEXT_LINK} inline-flex`}
            >
              <Glyph size={13} aria-hidden />
            </a>
          );
        }
        return (
          <span
            key={key}
            role="img"
            title={tooltip(label, state)}
            aria-label={name}
            className="inline-flex text-neutral-600"
          >
            <Glyph size={13} aria-hidden />
          </span>
        );
      })}
    </span>
  );
}

/**
 * One provider's state, read off the whole record rather than its own field: a
 * missing copy means something different depending on how the link's single
 * shared job ended. `unavailable` is terminal failure of both services;
 * otherwise a link that already holds one copy is finished, so the empty side
 * is settled rather than still coming.
 */
function copyState(copies: ArchivedCopiesPayload, href: string | null): CopyState {
  if (href) return "captured";
  if (copies.unavailable) return "failed";
  if (copies.wayback || copies.archive_today) return "missing";
  return "pending";
}

function accessibleName(label: string, describes: string, state: CopyState): string {
  switch (state) {
    case "captured":
      return `${label} copy of ${describes}`;
    case "failed":
      return `${describes}: archiving failed, no ${label} copy`;
    case "missing":
      return `No ${label} copy of ${describes}`;
    case "pending":
      return `${label} copy of ${describes}: archiving in progress`;
    case "unpublished":
      return `${label} copy of ${describes}: archived when published`;
  }
}

/**
 * The hover text, which says the same thing the accessible name does, minus
 * the target: the pointer is already on the icon, so what it points at is not
 * in question, and repeating it makes four near-identical tooltips on one row.
 */
function tooltip(label: string, state: CopyState): string {
  switch (state) {
    case "failed":
      return "Archiving failed, no copy available";
    case "missing":
      return `No ${label} copy was captured`;
    case "unpublished":
      return "Archived when published";
    default:
      return "Archiving in progress";
  }
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
