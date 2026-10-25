"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CountBadge } from "@/components/ui/CountBadge";
import { IncompleteFormAnnouncer } from "@/components/ui/IncompleteFormAnnouncer";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import type { DrawState } from "@/components/map/ZoneDrawMap";
import { useMutation } from "@/hooks/useMutation";
import { missingSummary } from "@/lib/events";
import { positionsBounds, zoneFromVertices, zoneVertices } from "@/lib/siteZone";
import {
  EMPTY_OBSERVATION,
  addObservation,
  observationBody,
  observationMissing,
  todayUtc,
  type ObservationDraft,
  type Site,
} from "@/lib/sites";
import { ObservationFields } from "./ObservationFields";
import { ZoneEditor, drawReady } from "./ZoneEditor";
import { toMapSite } from "./useSitesInView";

/**
 * The site page's observation form: the zone starts as the current one, its corners drag or the
 * whole ring is redrawn, and the imagery that proves it rides along. The current zone stays
 * drawn underneath for reference.
 */
export function AddObservationPanel({
  site,
  onSaved,
  onCancel,
}: {
  site: Site;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const today = todayUtc();
  const current = useMemo(() => zoneVertices(site.zone), [site.zone]);
  const [draw, setDraw] = useState<DrawState>({ vertices: current, closed: true });
  const [draft, setDraft] = useState<ObservationDraft>(EMPTY_OBSERVATION);
  const [attempt, setAttempt] = useState(0);
  const bounds = useMemo(() => positionsBounds(current) ?? undefined, [current]);
  // Drawn solid whatever its corroboration: here it is the reference outline, not a map reading.
  const reference = useMemo(() => [toMapSite({ ...site, is_corroborated: true })], [site]);

  const zone = drawReady(draw) ? zoneFromVertices(draw.vertices) : null;
  const missing = observationMissing(draft, zone, today);
  const save = useMutation(() => addObservation(site.id, observationBody(draft, zone!)), {
    fallback: "Failed to add the observation",
    onSuccess: onSaved,
  });

  return (
    <Card as="section" className="space-y-5">
      <SectionEyebrow title="Add an observation" concept="site_observation" margin="none" />
      <p className="text-sm text-neutral-400">
        The zone starts as the current one, shown underneath. Drag its corners, or redraw it, to
        match the new imagery. It applies from the capture date.
      </p>
      <ZoneEditor state={draw} onChange={setDraw} sites={reference} bounds={bounds} />
      <ObservationFields draft={draft} onChange={setDraft} today={today} />
      <IncompleteFormAnnouncer attempt={attempt} missing={attempt > 0 ? missing : []} />
      {save.error && <div className={FORM_ERROR_BANNER}>{save.error}</div>}
      <div className="flex flex-wrap gap-3">
        <CountBadge
          count={missing.length}
          label={missingSummary(missing.map((label) => ({ label })))}
        >
          {(describedBy) => (
            <Button
              variant="primary"
              disabled={save.loading}
              aria-describedby={describedBy}
              onClick={() => {
                if (missing.length > 0) setAttempt((n) => n + 1);
                else void save.run();
              }}
            >
              {save.loading ? "Saving…" : "Save observation"}
            </Button>
          )}
        </CountBadge>
        <Button variant="ghost" disabled={save.loading} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
