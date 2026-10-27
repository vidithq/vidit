import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { SegmentedControl, type SegmentedControlOption } from "./SegmentedControl";
import { PreferenceText } from "./ToggleRow";

/**
 * A pick-one preference row, the sibling of `<ToggleRow>` for a setting with a few named choices:
 * the label at reading size, over a line saying what it does when there is one, and a `<SegmentedControl>` named by
 * the label. Beside the text from `sm` up; below `sm` the bar drops under it and takes the
 * full column, where three choices would otherwise crowd the label.
 */
export function ChoiceRow<T extends string>({
  label,
  description,
  options,
  value,
  onChange,
  className = "",
}: {
  label: string;
  /** A line under the label saying what the setting does. */
  description?: ReactNode;
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** The caller's own divider and spacing. */
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex max-sm:flex-col max-sm:items-stretch items-center justify-between gap-4",
        className,
      )}
    >
      <PreferenceText label={label} description={description} />
      <SegmentedControl aria-label={label} options={options} value={value} onChange={onChange} />
    </div>
  );
}
