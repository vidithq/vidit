"use client";

import { CharCounter } from "@/components/ui/CharCounter";
import { Textarea } from "@/components/ui/Input";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { EVENT_TITLE_MAX_LEN } from "@/lib/events";

interface TitleFieldProps {
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  /** The id of the `<form>` the field joins from outside it. */
  form?: string;
}

/** The event forms' Title field, in the event title's place (`EventShell`'s `titleField`): the
 *  title's size, weight and line height, its label for assistive tech only, the `?` beside it.
 *
 *  The typed text starts where the event title's text starts: the box bleeds left by its border
 *  and padding (13px) and up and down by the same 5px, so the text sits on the title's line and
 *  the header keeps the title's height. It is a one-row textarea that grows a row per wrapped
 *  line (`field-sizing: content`), so a long title wraps on a phone like the event title. A title
 *  is one line: Enter adds none and submits the form the field joins, as a text input does. The
 *  counter beside the `?` reads the title against `EVENT_TITLE_MAX_LEN`. */
export function TitleField({ value, onChange, invalid = false, form }: TitleFieldProps) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="title" className="sr-only">
        Title
      </label>
      <Textarea
        id="title"
        rows={1}
        required
        form={form}
        maxLength={EVENT_TITLE_MAX_LEN}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\s*[\r\n]+\s*/g, " "))}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
          e.preventDefault();
          const owner = form ? document.getElementById(form) : null;
          if (owner instanceof HTMLFormElement) owner.requestSubmit();
        }}
        placeholder="Title, e.g. Strike on ammunition depot, Donetsk"
        invalid={invalid}
        className="-my-[5px] -ml-[13px] min-w-0 flex-1 resize-none py-1 text-xl leading-7 font-medium field-sizing-content sm:text-xl"
      />
      <CharCounter length={value.length} max={EVENT_TITLE_MAX_LEN} />
      <FieldHelp concept="title" />
    </div>
  );
}
