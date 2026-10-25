import { Check, Circle } from "lucide-react";

import { Pill } from "@/components/ui/Pill";
import { FIELD_LABELS, type MissingFieldKey } from "@/lib/events";

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
export function PublishChecklist({
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
