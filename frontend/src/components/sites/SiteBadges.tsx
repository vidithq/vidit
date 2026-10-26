import { Pill, type PillTone } from "@/components/ui/Pill";
import {
  LINK_EFFECT_LABELS,
  SITE_KIND_LABELS,
  type LinkEffect,
  type SiteKind,
} from "@/lib/sites";

// Only damage and destruction carry colour, the two semantic tones a zone takes on the map too.
const LINK_EFFECT_TONE: Record<LinkEffect, PillTone> = {
  damage: "warning",
  destruction: "danger",
  activity: "neutral",
  other: "neutral",
};

export function SiteKindPill({ kind }: { kind: SiteKind }) {
  return <Pill tone="neutral">{SITE_KIND_LABELS[kind]}</Pill>;
}

/** A link's effect. `keyed` prints the field's name before it, where the row does not say it. */
export function LinkEffectPill({ effect, keyed = false }: { effect: LinkEffect; keyed?: boolean }) {
  return (
    <Pill tone={LINK_EFFECT_TONE[effect]} label={keyed ? "Effect" : undefined}>
      {LINK_EFFECT_LABELS[effect]}
    </Pill>
  );
}
