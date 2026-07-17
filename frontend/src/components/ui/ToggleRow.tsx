import { Switch } from "./Switch";

/** A compact on/off row for a boolean filter, shared by the filter surfaces.
 *  The whole row is the switch (role + click live here), so the `<Switch>`
 *  renders as its visual span. */
export function ToggleRow({
  label,
  on,
  onToggle,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className="w-full flex items-center justify-between py-2.5 border-b border-neutral-800 last:border-b-0 group"
    >
      <span className="text-[10px] text-neutral-500 uppercase tracking-wider group-hover:text-neutral-400 transition-colors">
        {label}
      </span>
      <Switch as="span" size="sm" on={on} />
    </button>
  );
}
