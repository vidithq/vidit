import { TAG_CHIP } from "./styles";

// Decorative (non-interactive) tag pill: the read-only counterpart to the
// clickable `TagChip` used by TagPicker. The `px-1.5 py-0.5 rounded-full` shape
// + neutral `TAG_CHIP` paint was inlined on every card and detail row.
export function TagBadge({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) {
  return (
    <span className={`px-1.5 py-0.5 rounded-full ${TAG_CHIP} ${className}`.trim()}>
      {name}
    </span>
  );
}
