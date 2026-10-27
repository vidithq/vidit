"use client";

import { CharCounter } from "@/components/ui/CharCounter";
import { Textarea } from "@/components/ui/Input";
import { FieldHelp } from "@/components/ui/FieldHelp";
import type { Concept } from "@/lib/fieldHelp";
import { PAGE_TITLE_TEXT } from "@/components/ui/PageShell";
import { cn } from "@/lib/cn";
import { EVENT_TITLE_MAX_LEN } from "@/lib/events";

interface TitleFieldProps {
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  /** The id of the `<form>` the field joins from outside it. */
  form?: string;
  /** What the field names, for assistive tech: *Title*, a site's *Name*. */
  label?: string;
  placeholder?: string;
  concept?: Concept;
  maxLength?: number;
}

/** The event forms' Title field, in the event title's place (`EventShell`'s `titleField`): the
 *  title's size, weight and line height, its label for assistive tech only, the `?` beside it.
 *  The site forms type the site's name in it, with their own `label`, `placeholder` and `?`.
 *
 *  The typed text starts where the event title's text starts: the box bleeds left by its border
 *  and padding (13px) and up and down by the same 5px, so the text sits on the title's line and
 *  the header keeps the title's height. It is a one-row textarea that grows a row per wrapped
 *  line (`field-sizing: content`), so a long title wraps on a phone like the event title. A title
 *  is one line: Enter adds none and submits the form the field joins, as a text input does. The
 *  counter beside the `?` reads the title against `maxLength`. */
export function TitleField({
  value,
  onChange,
  invalid = false,
  form,
  label = "Title",
  placeholder = "Title, e.g. Strike on ammunition depot, Donetsk",
  concept = "title",
  maxLength = EVENT_TITLE_MAX_LEN,
}: TitleFieldProps) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="title" className="sr-only">
        {label}
      </label>
      <Textarea
        id="title"
        rows={1}
        required
        form={form}
        maxLength={maxLength}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\s*[\r\n]+\s*/g, " "))}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
          e.preventDefault();
          const owner = form ? document.getElementById(form) : null;
          if (owner instanceof HTMLFormElement) owner.requestSubmit();
        }}
        placeholder={placeholder}
        invalid={invalid}
        // The bleed is the border plus the padding: `px-3` from `Input`'s `VARIANT.default`, `py-1`
        // here. Mirrors Input.tsx VARIANT.default; change both.
        className={cn(
          PAGE_TITLE_TEXT,
          "-my-[5px] -ml-[13px] min-w-0 flex-1 resize-none py-1 field-sizing-content sm:text-xl",
        )}
      />
      <CharCounter length={value.length} max={maxLength} />
      <FieldHelp concept={concept} />
    </div>
  );
}
