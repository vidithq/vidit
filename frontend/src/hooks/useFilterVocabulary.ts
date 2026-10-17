import { useApiResource } from "@/hooks/useApiResource";
import type { Conflict, Tag } from "@/types";

const NO_TAGS: Tag[] = [];
const NO_CONFLICTS: Conflict[] = [];

export function useFilterVocabulary(): { tags: Tag[]; conflicts: Conflict[] } {
  const { data: tags } = useApiResource<Tag[]>("/tags");
  // Only conflicts carried by at least one live event, not the whole referential.
  const { data: conflicts } = useApiResource<Conflict[]>("/conflicts?used=true");
  return { tags: tags ?? NO_TAGS, conflicts: conflicts ?? NO_CONFLICTS };
}
