"use client";

import { useRef, type ComponentProps } from "react";
import { Calendar, Clock } from "lucide-react";

import { cn } from "@/lib/cn";
import { Button } from "./Button";
import { Input } from "./Input";

/** `datetime-local` picks one instant, so it takes the calendar mark. */
type DateTimeType = "date" | "time" | "datetime-local";

/** `Calendar` for a day, `Clock` for a time of day. */
const PICKER: Record<DateTimeType, { icon: typeof Calendar; label: string }> = {
  date: { icon: Calendar, label: "Open the date picker" },
  time: { icon: Clock, label: "Open the time picker" },
  "datetime-local": { icon: Calendar, label: "Open the date and time picker" },
};

/**
 * A date, a time or an instant, entered through the native control with the
 * site's own mark.
 *
 * `.picker-glyph` hides the browser's own picker button (`globals.css`) and this
 * puts a ghost icon button in the trailing slot, opening the native picker via
 * `showPicker()`. A browser without it focuses the field. A date field too
 * narrow for an adornment (search filters, the map scrubber) stays a bare
 * `<Input type="date">`.
 *
 * The mark stands down below `sm` (see `trailingFromSm` below). It also owns
 * `has-value`, the class `globals.css` mutes an empty field's `dd/mm/yyyy`
 * placeholder off.
 */
export function DateTimeInput({
  type,
  value,
  className = "",
  ...props
}: {
  type: DateTimeType;
  value: string;
} & Omit<ComponentProps<typeof Input>, "type" | "value" | "trailing" | "ref">) {
  const ref = useRef<HTMLInputElement>(null);
  const { icon: Icon, label } = PICKER[type];

  const openPicker = () => {
    const field = ref.current;
    if (!field) return;
    // Focus first: the fallback when `showPicker` is missing or throws (no user
    // activation).
    field.focus();
    try {
      field.showPicker?.();
    } catch {
      // The field is focused: typing is the way in.
    }
  };

  return (
    <Input
      ref={ref}
      type={type}
      value={value}
      className={cn("picker-glyph", value ? "has-value" : "", className)}
      // Desktop only: at 320px a 36px button takes 42px of a 248px field, and
      // the tail of an instant would run under it. A tap opens the native picker.
      trailingFromSm
      trailing={
        <Button
          icon
          variant="ghost"
          onClick={openPicker}
          aria-label={label}
          title={label}
        >
          <Icon size={14} />
        </Button>
      }
      {...props}
    />
  );
}
