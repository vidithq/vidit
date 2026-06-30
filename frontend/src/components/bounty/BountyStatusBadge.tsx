import type { BountyStatus } from "@/types";
import { Pill } from "@/components/ui/Pill";
import {
  STATUS_PILL_ACTIVE,
  STATUS_PILL_CLOSED,
  STATUS_PILL_FULFILLED,
} from "@/components/ui/styles";

const TONE: Record<BountyStatus, string> = {
  open: STATUS_PILL_ACTIVE,
  fulfilled: STATUS_PILL_FULFILLED,
  closed: STATUS_PILL_CLOSED,
};

const LABEL: Record<BountyStatus, string> = {
  open: "Open",
  fulfilled: "Fulfilled",
  closed: "Closed",
};

/**
 * A bounty's lifecycle status as a coloured pill, sharing the one `Pill` shape
 * with the geolocation `StatusBadge` (named distinctly since it renders a
 * `BountyStatus`). Shared by the bounty list and detail pages.
 */
export default function BountyStatusBadge({ status }: { status: BountyStatus }) {
  return <Pill tone={TONE[status]}>{LABEL[status]}</Pill>;
}
