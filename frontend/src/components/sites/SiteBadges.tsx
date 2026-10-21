import { Pill, type PillTone } from "@/components/ui/Pill";
import {
  LINK_EFFECT_LABELS,
  OBSERVATION_EFFECT_LABELS,
  SITE_TYPE_LABELS,
  corroborationLabel,
  type LinkEffect,
  type ObservationEffect,
  type Site,
  type SiteType,
} from "@/lib/sites";

// Only damage and destruction carry colour, the two semantic tones the site's zone takes too.
const LINK_EFFECT_TONE: Record<LinkEffect, PillTone> = {
  damage: "warning",
  destruction: "danger",
  other: "neutral",
};

export function SiteTypePill({ type }: { type: SiteType }) {
  return <Pill tone="neutral">{SITE_TYPE_LABELS[type]}</Pill>;
}

export function CorroborationPill({
  site,
}: {
  site: Pick<Site, "is_corroborated" | "corroboration_count">;
}) {
  return <Pill tone="neutral">{corroborationLabel(site)}</Pill>;
}

export function LinkEffectPill({ effect }: { effect: LinkEffect }) {
  return (
    <Pill tone={LINK_EFFECT_TONE[effect]} label="Effect">
      {LINK_EFFECT_LABELS[effect]}
    </Pill>
  );
}

export function ObservationEffectPill({ effect }: { effect: ObservationEffect }) {
  return <Pill tone="neutral">{OBSERVATION_EFFECT_LABELS[effect]}</Pill>;
}
