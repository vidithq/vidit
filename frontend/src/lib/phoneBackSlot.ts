/**
 * The back control's seat in the phone chip, and the subscription a page fills
 * it through.
 *
 * `Sidebar` owns the element (`#phone-back-slot`) and publishes it here from a
 * ref; `PageShell` subscribes and portals its back control into it below `sm`,
 * so on a phone the arrow rides the chip in the corner instead of taking a row
 * of its own above the title. Nothing else reads the slot: the chip holds the
 * open control and this seat, and the drawer's brand mark stays in the drawer.
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
  // Copied first: a listener may unsubscribe while the set is being walked.
  for (const listener of [...listeners]) listener();
}

export function subscribePhoneBackSlot(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The slot, or null before `Sidebar` has published one. Also the server
 *  snapshot: only a ref callback ever sets it, so a prerender reads null and
 *  portals nothing. */
export function getPhoneBackSlot(): HTMLElement | null {
  return slot;
}
