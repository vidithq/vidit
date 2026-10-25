"use client";

import { useId, useState, type ReactNode } from "react";
import { Check, ChevronDown, Circle } from "lucide-react";

import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FIELD_LABELS, type MissingFieldKey } from "@/lib/events";
import type { Concept } from "@/lib/fieldHelp";

/** A publish-floor requirement shown as a tick. `keys` are the `missingEvent*` field keys it
 *  covers (proof needs two), so met state derives from the live missing set and the validator
 *  stays the one source of truth. */
type Req = { label: string; keys: MissingFieldKey[] };

/** The request floor: enough to be actionable by someone else, a subset of the publish floor. */
export const REQUEST_REQS: Req[] = [
  { label: FIELD_LABELS.title, keys: ["title"] },
  { label: FIELD_LABELS.source_file, keys: ["source_file"] },
  { label: FIELD_LABELS.source_link, keys: ["source_link"] },
  { label: FIELD_LABELS.source_kind, keys: ["source_kind"] },
];

/** What a geolocation adds on top of the request floor. */
export const GEO_EXTRA_REQS: Req[] = [
  { label: FIELD_LABELS.coordinates, keys: ["coordinates"] },
  { label: FIELD_LABELS.proof_image, keys: ["proof", "proof_image"] },
  { label: FIELD_LABELS.conflict_tag, keys: ["conflict_tag"] },
];

/** The whole publish floor, as the edit form of a request or a detection lists it. */
export const PUBLISH_REQS: Req[] = [...REQUEST_REQS, ...GEO_EXTRA_REQS];

/**
 * The readiness tick-list of a publish action: one static Pill per requirement (`secondary` tone
 * once met, `neutral` while pending), so it can't be mistaken for a selectable chip.
 */
function PublishChecklist({
  reqs,
  missing,
}: {
  reqs: Req[];
  missing: ReadonlySet<MissingFieldKey>;
}) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {reqs.map((r) => {
        const met = r.keys.every((k) => !missing.has(k));
        return (
          <li key={r.label}>
            <Pill
              tone={met ? "secondary" : "neutral"}
              icon={
                met ? (
                  <Check size={12} strokeWidth={2.5} />
                ) : (
                  <Circle size={9} strokeWidth={2} />
                )
              }
            >
              {r.label}
            </Pill>
          </li>
        );
      })}
    </ul>
  );
}

/** One outcome's conditions: its title, then its chips. */
export interface ConditionGroup {
  title: string;
  concept: Concept;
  reqs: Req[];
  missing: ReadonlySet<MissingFieldKey>;
}

/**
 * The publish conditions under the sticky publish buttons, as two nodes: `list`, one titled
 * `PublishChecklist` per group, and `toggle`, which stands for the list on a phone. Below `sm`
 * the list folds away and the toggle names how many conditions are unmet (*3 missing*); a tap
 * shows the list. The caller puts the toggle in its button row and the list under it.
 */
export function usePublishConditions(groups: ConditionGroup[]): {
  toggle: ReactNode;
  list: ReactNode;
} {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const unmet = groups.reduce(
    (n, g) => n + g.reqs.filter((r) => r.keys.some((k) => g.missing.has(k))).length,
    0,
  );
  return {
    toggle: (
      <Button
        variant="ghost"
        className="sm:hidden"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
      >
        {unmet > 0 ? `${unmet} missing` : "Nothing missing"}
        <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} />
      </Button>
    ),
    list: (
      <div id={listId} className={cn("space-y-2", !open && "max-sm:hidden")}>
        {groups.map((g) => (
          <div key={g.title} className="space-y-1.5">
            <SectionEyebrow title={g.title} concept={g.concept} margin="none" />
            <PublishChecklist reqs={g.reqs} missing={g.missing} />
          </div>
        ))}
      </div>
    ),
  };
}
