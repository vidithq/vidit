import type { components } from "@/lib/api-types";

type TagRead = components["schemas"]["TagRead"];
type ConflictRead = components["schemas"]["ConflictRead"];

/** One card pill. A `label` makes it a key/value pill (`Conflict: Russo-Ukrainian war`). */
export interface CardTag {
  id: string;
  name: string;
  label?: string;
}

/** An event's taxonomy as card pills: its conflicts, keyed by their field name, then its tags,
 *  plain. A card carries no source, so it names no sensor. */
export function cardTags(event: { tags: TagRead[]; conflicts: ConflictRead[] }): CardTag[] {
  return [
    ...event.conflicts.map((c) => ({ id: c.id, name: c.name, label: "Conflict" })),
    ...event.tags.map((t) => ({ id: t.id, name: t.name })),
  ];
}
