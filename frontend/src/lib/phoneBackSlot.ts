/**
 * The one slot the phone top bar keeps beside its open control, and the
 * subscription a page fills it through.
 *
 * `Sidebar` owns the element (`#phone-back-slot`) and publishes it here from a
 * ref; `PageShell` subscribes and portals its back control into it, so on a
 * phone the arrow rides the 48px bar instead of taking a row of its own above
 * the title. Nothing here holds "is there a back arrow": the bar reads its own
 * slot with `:has(#phone-back-slot:not(:empty))` to yield the brand mark.
 *
 * A store rather than a lookup at mount, because the two mount out of order:
 * `Sidebar` renders nothing while auth resolves, so the slot can appear after
 * the page asking for it has already mounted, and a one-shot
 * `getElementById` would miss it on every cold load.
 */

type Listener = () => void;

let slot: HTMLElement | null = null;
const listeners = new Set<Listener>();

/** Ref callback for the slot element. React passes `null` on unmount. */
export function setPhoneBackSlot(element: HTMLElement | null): void {
  if (slot === element) return;
  slot = element;
  for (const listener of listeners) listener();
}

export function subscribePhoneBackSlot(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPhoneBackSlot(): HTMLElement | null {
  return slot;
}

/** No DOM on the server, so the prerender pass portals nothing. */
export function getServerPhoneBackSlot(): null {
  return null;
}
