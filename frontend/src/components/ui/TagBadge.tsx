import { Pill } from "./Pill";
import { TAG_CHIP } from "./styles";

// Decorative (non-interactive) tag pill: the read-only counterpart to the
// clickable `TagChip` used by TagPicker. Shares the one `Pill` shape; neutral
// `TAG_CHIP` paint, no icon. Inlined on every card and detail row before.
export function TagBadge({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) {
  return (
    <Pill tone={TAG_CHIP} className={className}>
      {name}
    </Pill>
  );
}
