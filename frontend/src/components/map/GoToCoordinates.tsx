"use client";

import { useId, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FORM_LABEL } from "@/components/ui/form-styles";
import { readCoordinates, type CoordinatePair } from "@/lib/coordinates";
import { FieldError } from "@/components/ui/ErrorNotice";

/**
 * The go-to-coordinates field: a `lat, lng` pair in decimal degrees, or a Google Maps URL, then
 * **Go**. Enter goes too. A pair it cannot read, or one out of bounds, stays in the field with
 * the reason under it. The caller moves the map: `GoToCoordinatesControl` on the map itself, a
 * `goTo` target on `<Map>` from beside it. No map import, so a form can render it on the server.
 */
export function GoToCoordinates({
  onGo,
  autoFocus = false,
}: {
  onGo: (pair: CoordinatePair) => void;
  /** Takes focus on mount, in a panel that opens for it. */
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const errorId = useId();

  const go = () => {
    const read = readCoordinates(text);
    if ("error" in read) {
      setError(read.error);
      return;
    }
    setError(null);
    onGo(read.pair);
  };

  // No `<form>`: the field sits inside the site forms, and a form cannot nest.
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    go();
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor={fieldId} className={FORM_LABEL}>
        Go to coordinates
      </label>
      <div className="flex gap-1.5">
        <Input
          id={fieldId}
          type="text"
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
          placeholder="48.015883, 37.802411"
          invalid={error !== null}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          className="font-mono"
        />
        <Button variant="secondary" onClick={go}>
          Go
        </Button>
      </div>
      <FieldError id={errorId} alert>
        {error}
      </FieldError>
    </div>
  );
}
