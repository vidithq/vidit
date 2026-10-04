/**
 * The back control's seat in the phone chip, and the subscription a page fills it through.
 * `Sidebar` publishes the element (`#phone-back-slot`) from a ref; `PageShell` portals its
 * back control into it below `sm`.
 *
 * A store rather than a mount-time lookup: `Sidebar` renders nothing while auth resolves, so
 * the slot can appear after the page asking for it mounted, and a one-shot `getElementById`
 * would miss it on every cold load.
 */

type Listener = () => void;

let slot: HTMLElement | null = null;
const listeners = new Set<Listener>();

/** Ref callback for the slot element. React passes `null` on unmount. */
export function setPhoneBackSlot(element: HTMLElement | null): void {
  if (slot === element) return;
  slot = element;
  // Copied first: a listener may unsubscribe while the set is being walked.
  for (const listener of [...listeners]) listener();
}

export function subscribePhoneBackSlot(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The slot, or null before `Sidebar` publishes one. Also the server snapshot: a prerender
 *  reads null and portals nothing. */
export function getPhoneBackSlot(): HTMLElement | null {
  return slot;
}
