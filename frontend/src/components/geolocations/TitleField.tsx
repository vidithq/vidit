"use client";

import { Input } from "@/components/ui/Input";
import { FieldHelp } from "@/components/ui/FieldHelp";

interface TitleFieldProps {
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  /** The id of the `<form>` the field joins from outside it. */
  form?: string;
}

/** The event forms' Title field, in the event title's place (`EventShell`'s `titleField`): the
 *  title's size and weight, its label for assistive tech only, the `?` beside it. */
export function TitleField({ value, onChange, invalid = false, form }: TitleFieldProps) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="title" className="sr-only">
        Title
      </label>
      <Input
        id="title"
        type="text"
        required
        form={form}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Title, e.g. Strike on ammunition depot, Donetsk"
        invalid={invalid}
        className="py-1 text-xl sm:text-xl font-medium"
      />
      <FieldHelp concept="title" />
    </div>
  );
}
