"use client";

import { FORM_INVALID_LABEL, FORM_LABEL } from "@/components/ui/form-styles";
import { Input } from "@/components/ui/Input";
import { FieldHelp } from "@/components/ui/FieldHelp";

interface TitleFieldProps {
  value: string;
  onChange: (v: string) => void;
  /** Flag as a missing required field (red outline). */
  invalid?: boolean;
}

/** The "Title" field — leads both the submit and detection-edit forms, so it's
 *  one shared brick (label + `?` help + input) and can't drift between them. */
export function TitleField({ value, onChange, invalid = false }: TitleFieldProps) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor="title"
        className={`${FORM_LABEL}${invalid ? ` ${FORM_INVALID_LABEL}` : ""}`}
      >
        Title <FieldHelp concept="title" />
      </label>
      <Input
        id="title"
        type="text"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. Strike on ammunition depot, Donetsk"
        invalid={invalid}
      />
    </div>
  );
}
