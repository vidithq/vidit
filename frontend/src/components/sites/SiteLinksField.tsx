"use client";

import { useRef, useState } from "react";
import { Link2, SquarePen } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { EntityCard } from "@/components/ui/EntityCard";
import { RemoveButton } from "@/components/ui/RemoveButton";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { META_LINE } from "@/components/ui/styles";
import { searchPickableEvents, type PickableEvent } from "@/lib/collections";
import { formatDate } from "@/lib/format";
import { eventHref } from "@/lib/routes";
import type { LinkEffect, SiteEventLinkCreate } from "@/lib/sites";
import type { components } from "@/lib/api-types";
import { CHANGE_EFFECT_COPY, LinkDialog, type LinkCandidate } from "./LinkDialog";
import { LinkEffectPill } from "./SiteBadges";

type Author = components["schemas"]["AuthorRef"];

/** One of the analyst's events a site form links, with what it shows at the site. */
export type DraftLink = Pick<PickableEvent, "id" | "title" | "occurred_date" | "media" | "is_graphic"> & {
  effect: LinkEffect;
};

/** The link dialog's words when an analyst links one of their own events to a site. */
export const OWN_EVENT_LINK_COPY = {
  title: "Link one of my events",
  intro:
    "Pick one of your published events, then say what it shows at this site. The link holds even when the event lies outside the zone.",
  pickLabel: "Event",
  searchLabel: "Search your events by title",
  searchPlaceholder: "Search your events by title",
};

export function eventCandidate(event: Pick<DraftLink, "id" | "title" | "occurred_date">): LinkCandidate {
  return {
    id: event.id,
    label: event.title,
    meta: event.occurred_date ? formatDate(event.occurred_date) : "Undated",
  };
}

/** The analyst's published events whose title matches, less those in `exclude`. */
export async function searchOwnEvents(
  username: string,
  q: string,
  exclude: ReadonlySet<string>,
): Promise<PickableEvent[]> {
  const { items } = await searchPickableEvents(username, q);
  return items.filter((e) => e.status === "geolocated" && !exclude.has(e.id));
}

export function linkPayload(links: DraftLink[]): SiteEventLinkCreate[] {
  return links.map((link) => ({ event_id: link.id, effect: link.effect }));
}

type Dialog = { kind: "link" } | { kind: "effect"; link: DraftLink };

/**
 * The Linked events block of a site form: the analyst's own events the site links, one catalogue
 * card each with its effect, its effect change and its unlink, then **Link one of my events**,
 * which opens the site page's link dialog. Nothing is written until the form saves.
 */
export function SiteLinksField({
  links,
  onChange,
  author,
}: {
  links: DraftLink[];
  onChange: (links: DraftLink[]) => void;
  author: Author;
}) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // The dialog hands back a candidate; the card needs the event it was found as.
  const found = useRef(new Map<string, PickableEvent>());
  const linked = new Set(links.map((link) => link.id));

  return (
    <section className="space-y-2">
      <SectionEyebrow title={`Linked events (${links.length})`} concept="site_linked_events" margin="none" />
      {links.length === 0 ? (
        <EmptyState>None of your events is linked to this site.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {links.map((link) => (
            <li key={link.id}>
              <EntityCard
                variant="compact"
                uniformHeight={false}
                detailHref={eventHref(link.id)}
                title={link.title}
                media={link.media ?? undefined}
                isGraphic={link.is_graphic}
                author={author}
                date={link.occurred_date ?? undefined}
                badge={<LinkEffectPill effect={link.effect} />}
                actions={
                  <>
                    <Button
                      icon
                      variant="ghost"
                      aria-label={`Change the effect of ${link.title}`}
                      onClick={() => setDialog({ kind: "effect", link })}
                    >
                      <SquarePen size={14} />
                    </Button>
                    <RemoveButton
                      label={`Unlink ${link.title}`}
                      onClick={() => onChange(links.filter((l) => l.id !== link.id))}
                    />
                  </>
                }
              />
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={META_LINE}>Only your own events. Other authors link theirs from the site page.</p>
        <Button variant="secondary" onClick={() => setDialog({ kind: "link" })}>
          <Link2 size={13} />
          Link one of my events
        </Button>
      </div>
      {dialog?.kind === "link" && (
        <LinkDialog
          {...OWN_EVENT_LINK_COPY}
          search={async (q) => {
            const rows = await searchOwnEvents(author.username, q, linked);
            for (const row of rows) found.current.set(row.id, row);
            return rows.map(eventCandidate);
          }}
          onLink={async (picked, effect) => {
            const event = found.current.get(picked.id)!;
            onChange([...links, { ...event, effect }]);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "effect" && (
        <LinkDialog
          {...OWN_EVENT_LINK_COPY}
          {...CHANGE_EFFECT_COPY}
          search={async () => []}
          initial={{ candidate: eventCandidate(dialog.link), effect: dialog.link.effect }}
          onLink={async (_, effect) => {
            onChange(links.map((l) => (l.id === dialog.link.id ? { ...l, effect } : l)));
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}
