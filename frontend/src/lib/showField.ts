/** What the filter panel's Show field lists, on the map and on search. `show` is the selected
 * status chips; `othersSelected` says whether a chip after them is selected (the map's Sites,
 * search's Sites, Collections, Analysts and Organizations). With no chip selected, every event
 * and every other kind shows; once a chip is selected, only what the selected chips name. */
export function showFieldScope(
  show: string[],
  othersSelected: boolean,
): { events: boolean; others: boolean } {
  const none = show.length === 0 && !othersSelected;
  return { events: none || show.length > 0, others: none || othersSelected };
}
