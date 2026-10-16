import type { components } from "@/lib/api-types";

type TagRead = components["schemas"]["TagRead"];
type ConflictRead = components["schemas"]["ConflictRead"];

/** One card pill. A `label` makes it a key/value pill (`Conflict: Russo-Ukrainian war`). */
export interface CardTag {
  id: string;
  name: string;
  label?: string;
}

/** The capture source an analyst picks when the footage does not say. A keyed pill carrying it
 *  says nothing, so cards drop it. Mirrors the "Unknown" row the baseline migration seeds into
 *  `CAPTURE_SOURCE_TAGS`; change both. */
const UNKNOWN_VALUE = "Unknown";

/** An event's taxonomy as card pills: conflicts, then capture sources, keyed by their field
 *  name; free tags after them, plain. A keyed value of Unknown is dropped. */
export function cardTags(event: {
  tags: TagRead[];
  conflicts: ConflictRead[];
}): CardTag[] {
  const keyed: CardTag[] = [
    ...event.conflicts.map((c) => ({ id: c.id, name: c.name, label: "Conflict" })),
    ...event.tags
      .filter((t) => t.category === "capture_source")
      .map((t) => ({ id: t.id, name: t.name, label: "Capture source" })),
  ];
  return [
    ...keyed.filter((t) => t.name !== UNKNOWN_VALUE),
    ...event.tags
      .filter((t) => t.category === "free")
      .map((t) => ({ id: t.id, name: t.name })),
  ];
}
