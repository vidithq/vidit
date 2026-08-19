"use client";

import { useRef, type ComponentProps } from "react";
import { Calendar, Clock } from "lucide-react";

import { cn } from "@/lib/cn";
import { Glyph } from "./Glyph";
import { Input } from "./Input";

/** The three native pickers a form here uses. `datetime-local` picks one
 *  instant, so it reads as a date field and takes the calendar mark. */
type DateTimeType = "date" | "time" | "datetime-local";

/** One mark per kind of picker, and the name it opens under. `Calendar` for
 *  anything that picks a day, `Clock` for a time of day, so a reader tells the
 *  two apart at 13px without reading the label above the field. */
const PICKER: Record<DateTimeType, { icon: typeof Calendar; label: string }> = {
  date: { icon: Calendar, label: "Open the date picker" },
  time: { icon: Clock, label: "Open the time picker" },
  "datetime-local": { icon: Calendar, label: "Open the date and time picker" },
};

/**
 * A date, a time or an instant, entered through the native control but wearing
 * the site's own mark.
 *
 * The browser draws its own picker button inside a date field, in its own
 * chrome and at its own size, which on the dark field reads as a foreign
 * element beside the marks every other field carries. `.picker-glyph` hides it
 * (`globals.css`) and this brick puts the site's accent
 * [`<Glyph>`](./Glyph.tsx) in the field's trailing slot instead, opening the
 * same native picker through `showPicker()`. A browser without `showPicker`
 * focuses the field, which is where its own keyboard entry starts.
 *
 * One brick rather than three fields wiring the same mark: the event date, the
 * event time and the source post time are the same control with a different
 * unit, and the submit form and the edit form show the same three. A date field
 * too narrow for an adornment (the search filters, the map scrubber) stays a
 * bare `<Input type="date">` and keeps the native button.
 *
 * It also owns `has-value`, the class `globals.css` mutes an empty field's
 * `dd/mm/yyyy` placeholder off. The value is right here, so no call site has to
 * remember to derive it.
 */
export function DateTimeInput({
  type,
  value,
  className = "",
  ...props
}: {
  type: DateTimeType;
  /** Controlled: the brick derives the empty-placeholder styling from it. */
  value: string;
} & Omit<ComponentProps<typeof Input>, "type" | "value" | "trailing" | "ref">) {
  const ref = useRef<HTMLInputElement>(null);
  const { icon, label } = PICKER[type];

  const openPicker = () => {
    const field = ref.current;
    if (!field) return;
    // Focus first, so the fallback is already done when `showPicker` is missing
    // or refuses (it throws where the call is not user-activated).
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
      trailing={<Glyph icon={icon} label={label} onClick={openPicker} />}
      {...props}
    />
  );
}
