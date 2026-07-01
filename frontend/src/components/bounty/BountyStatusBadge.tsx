import type { BountyStatus } from "@/types";
import { Pill, type PillTone } from "@/components/ui/Pill";

// open draws attention (accent), fulfilled is a completed end-state (strong
// white, not green — completion isn't a win), closed is withdrawn (neutral).
const TONE: Record<BountyStatus, PillTone> = {
  open: "accent",
  fulfilled: "strong",
  closed: "neutral",
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
