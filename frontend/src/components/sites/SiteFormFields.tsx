"use client";

import { useEffect, useRef } from "react";

import { TitleField } from "@/components/geolocations/TitleField";
import { Card } from "@/components/ui/Card";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { OptionSearch } from "@/components/ui/OptionSearch";
import { drawFromZone, drawReady, EMPTY_DRAW, zoneFromVertices, zoneVertices } from "@/lib/siteZone";
import { SITE_KIND_LABELS, SITE_KINDS, SITE_NAME_MAX_LEN, type SiteKind, type Zone } from "@/lib/sites";
import type { MapBounds } from "@/lib/viewport";
import { ZoneEditor, useDrawHistory } from "./ZoneEditor";

/** The site forms' Name field, typed in the page title like an event form's Title. */
export function SiteNameField({
  value,
  onChange,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
}) {
  return (
    <TitleField
      value={value}
      onChange={onChange}
      invalid={invalid}
      label="Name"
      placeholder="Name, e.g. Northern fuel depot"
      concept="site_name"
      maxLength={SITE_NAME_MAX_LEN}
    />
  );
}

/** The Details block of a site form: the kind. */
export function SiteKindCard({
  value,
  onChange,
  invalid,
}: {
  value: SiteKind | "";
  onChange: (value: SiteKind | "") => void;
  invalid: boolean;
}) {
  return (
    <Card dense>
      <div className="space-y-1.5">
        <FieldLabel label="Kind" concept="site_kind" htmlFor="site-kind" invalid={invalid} />
        <OptionSearch
          single
          required
          id="site-kind"
          aria-label="Kind"
          placeholder="Search site kinds"
          options={SITE_KINDS.map((kind) => ({ value: kind, label: SITE_KIND_LABELS[kind] }))}
          selected={value ? [value] : []}
          invalid={invalid}
          onChange={(next) => onChange((next[0] ?? "") as SiteKind | "")}
        />
      </div>
    </Card>
  );
}

/** What a contour draft says against the contour its source carries: `undefined` when it holds
 *  that contour, `null` when it holds none, `"open"` while its ring is not closed or its edges
 *  cross, else the new zone. */
export type ContourDraftValue = Zone | null | "open" | undefined;

/**
 * The contour of one source in a site form: the `ZoneEditor` started on `start`, its changes
 * reported against `live`, the contour the source carries. Mount one per source (`key`), since the
 * editor's undo stack belongs to the source it draws on. An empty ring means no contour.
 */
export function ContourDraft({
  live,
  start,
  reference,
  onChange,
  bounds,
  invalid,
}: {
  live: Zone | null;
  start: Zone | null;
  /** The zone shown dashed, which **Back to the current contour** restores. */
  reference: Zone | null;
  onChange: (value: ContourDraftValue) => void;
  bounds?: MapBounds;
  invalid: boolean;
}) {
  const history = useDrawHistory(start ? drawFromZone(start) : EMPTY_DRAW);
  const report = useRef(onChange);
  useEffect(() => {
    report.current = onChange;
  });
  const { state } = history;
  useEffect(() => {
    const baseline = JSON.stringify(live ? zoneVertices(live) : []);
    if (JSON.stringify(state.vertices) === baseline && (state.closed || !live)) {
      report.current(undefined);
    } else if (state.vertices.length === 0) {
      report.current(null);
    } else {
      report.current(drawReady(state) ? zoneFromVertices(state.vertices) : "open");
    }
  }, [state, live]);
  return (
    <ZoneEditor
      label="Contour"
      history={history}
      reference={reference}
      onReset={reference ? () => history.change(drawFromZone(reference)) : undefined}
      bounds={bounds}
      invalid={invalid}
    />
  );
}
