import { FILTER_GROUPS } from "@/components/filters/model";
import { FILTER_GROUPS_KEY } from "@/components/filters/openGroups";

/** Opens every group of the filter panel, as a viewer who expanded them all. */
export function openFilterGroups() {
  localStorage.setItem(FILTER_GROUPS_KEY, JSON.stringify(FILTER_GROUPS.map((g) => g.title)));
}
