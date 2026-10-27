"use client";

import { useState } from "react";

import { ToggleRow } from "@/components/ui/ToggleRow";
import { errorMessage } from "@/lib/api";
import { formatInstant } from "@/lib/format";
import { fileSiteSource, siteSourceFromEventSource } from "@/lib/sites";
import { sourceName, type Source } from "@/lib/sources";

/** The event's satellite sources, each with its position in the event for its name. */
function satelliteSources(sources: Source[]) {
  return sources
    .map((source, index) => ({ source, index }))
    .filter(({ source }) => source.kind === "satellite");
}

/**
 * The link dialog's offer to file an event's satellite sources on the site too, one switch per
 * satellite source, all off at first. A source without a file or a capture time, or flagged
 * graphic, cannot be filed, so its switch reads why and refuses. Renders nothing for an event
 * with no satellite source. The caller holds the picks and files them with `fileOffered`.
 */
export function SatelliteSourcesOffer({
  sources,
  picked,
  onToggle,
}: {
  sources: Source[];
  picked: ReadonlySet<string>;
  onToggle: (sourceId: string) => void;
}) {
  const offered = satelliteSources(sources);
  if (offered.length === 0) return null;
  return (
    <fieldset className="space-y-2 border-t border-neutral-800 pt-3">
      <legend className="sr-only">File the event&apos;s satellite sources on the site</legend>
      {offered.map(({ source, index }) => {
        const fileable = siteSourceFromEventSource(source) !== null;
        const what = source.title || "Satellite source";
        return (
          <ToggleRow
            key={source.id}
            label={`Also file ${sourceName(index).toLowerCase()} on the site`}
            description={
              fileable
                ? `${what}, captured ${formatInstant(source.captured_at)}`
                : source.is_graphic
                  ? `${what}: a source flagged graphic cannot be filed on a site.`
                  : `${what}: a site source needs a file and a capture time, and this source lacks one.`
            }
            on={fileable && picked.has(source.id)}
            disabled={!fileable}
            onToggle={() => onToggle(source.id)}
          />
        );
      })}
    </fieldset>
  );
}

/** The picks of a `SatelliteSourcesOffer`, cleared when the event changes. */
export function useSatelliteOffer() {
  const [picked, setPicked] = useState<{ eventId: string | null; ids: Set<string> }>({
    eventId: null,
    ids: new Set(),
  });
  const forEvent = (eventId: string) => (picked.eventId === eventId ? picked.ids : new Set<string>());
  const toggle = (eventId: string, sourceId: string) =>
    setPicked(() => {
      const ids = new Set(forEvent(eventId));
      if (ids.has(sourceId)) ids.delete(sourceId);
      else ids.add(sourceId);
      return { eventId, ids };
    });
  return { forEvent, toggle };
}

/** Files the picked sources on the site, one request each. A refusal names the source and
 *  stops there: the link itself is already made. */
export async function fileOffered(siteId: string, sources: Source[], picked: ReadonlySet<string>) {
  for (const { source, index } of satelliteSources(sources)) {
    const body = siteSourceFromEventSource(source);
    if (!body || !picked.has(source.id)) continue;
    try {
      await fileSiteSource(siteId, body);
    } catch (err) {
      throw new Error(
        `The link is made, but ${sourceName(index).toLowerCase()} was not filed: ${errorMessage(err, "the request failed")}`,
      );
    }
  }
}
