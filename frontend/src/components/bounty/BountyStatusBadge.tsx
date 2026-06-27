import type { BountyStatus } from "@/types";
import {
  STATUS_PILL_ACTIVE,
  STATUS_PILL_CLOSED,
  STATUS_PILL_FULFILLED,
} from "@/components/ui/styles";

/**
 * A bounty's lifecycle status as a coloured pill. Shared by the bounty list and
 * detail pages so the two surfaces can't drift; named distinctly from the
 * geolocation `StatusBadge` (which renders a `GeolocationStatus`).
 */
export default function BountyStatusBadge({ status }: { status: BountyStatus }) {
  const classes: Record<BountyStatus, string> = {
    open: STATUS_PILL_ACTIVE,
    fulfilled: STATUS_PILL_FULFILLED,
    closed: STATUS_PILL_CLOSED,
  };
  return (
    <span
      className={`shrink-0 px-1.5 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-semibold ${classes[status]}`}
    >
      {status}
    </span>
  );
}
