import { useApiResource } from "@/hooks/useApiResource";
import type { Conflict, Tag } from "@/types";

const NO_TAGS: Tag[] = [];
const NO_CONFLICTS: Conflict[] = [];

/** The event filter panel's pickers: the live tag taxonomy, and only the conflicts at least one
 *  live event carries, not the whole referential. Empty while loading and on a failed read. */
export function useFilterVocabulary(): { tags: Tag[]; conflicts: Conflict[] } {
  const { data: tags } = useApiResource<Tag[]>("/tags");
  const { data: conflicts } = useApiResource<Conflict[]>("/conflicts?used=true");
  return { tags: tags ?? NO_TAGS, conflicts: conflicts ?? NO_CONFLICTS };
}
