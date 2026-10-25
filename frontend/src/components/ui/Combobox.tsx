"use client";

import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";
import { Input } from "./Input";
import { Pill } from "./Pill";
import { TOOLTIP_SURFACE } from "./styles";

const ROW =
  "flex w-full min-h-9 cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-sm text-neutral-200";
const STATUS_ROW = "px-2.5 py-1.5 text-xs text-neutral-500";

const LIST_MAX_HEIGHT = 240;
const LIST_GAP = 4;
const VIEWPORT_MARGIN = 8;

// Fixed to the viewport from a portal, so an `overflow` ancestor (a card, a scrolling rail) cannot
// clip the list. It opens above the field when the room below is short and the room above larger.
function placeList(field: DOMRect): CSSProperties {
  const below = window.innerHeight - field.bottom - LIST_GAP - VIEWPORT_MARGIN;
  const above = field.top - LIST_GAP - VIEWPORT_MARGIN;
  const up = below < LIST_MAX_HEIGHT && above > below;
  return {
    position: "fixed",
    left: field.left,
    width: field.width,
    maxHeight: Math.min(LIST_MAX_HEIGHT, up ? above : below),
    ...(up ? { bottom: window.innerHeight - field.top + LIST_GAP } : { top: field.bottom + LIST_GAP }),
  };
}

// Keeps the previous object for the same box, so a render that re-measures does not start another.
function placeAgainst(
  field: HTMLElement | null,
  setPlacement: Dispatch<SetStateAction<CSSProperties | null>>,
) {
  if (!field) return;
  const next = placeList(field.getBoundingClientRect());
  setPlacement((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
}

interface ComboboxProps<T> {
  /** The rows on show, already filtered by the caller. */
  options: T[];
  optionKey: (option: T) => string;
  renderOption: (option: T) => ReactNode;
  /** Shows the row inside a neutral `<Pill>`, the chip a pick becomes. */
  pillOption?: (option: T) => boolean;
  onPick: (option: T) => void;
  query: string;
  onQueryChange: (query: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A muted row under the options: loading, a failure, an empty list, a note. */
  status?: string | null;
  /** Takes the trimmed text when Enter finds no highlighted row. */
  onSubmitText?: (text: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  id?: string;
  "aria-label"?: string;
  placeholder?: string;
  maxLength?: number;
  autoFocus?: boolean;
  /** The red outline of a field a submit flagged. */
  invalid?: boolean;
  className?: string;
}

/**
 * A `role="combobox"` field over a `role="listbox"` list: the keyboard and the list of every
 * typeahead. The caller owns the query, the open state and the options. ArrowUp and ArrowDown
 * move and wrap, Enter picks the highlighted row or hands the text to `onSubmitText`, and Escape
 * or a blur closes.
 */
export function Combobox<T>({
  options,
  optionKey,
  renderOption,
  pillOption,
  onPick,
  query,
  onQueryChange,
  open,
  onOpenChange,
  status,
  onSubmitText,
  inputRef,
  id,
  "aria-label": ariaLabel,
  placeholder,
  maxLength,
  autoFocus,
  invalid = false,
  className,
}: ComboboxProps<T>) {
  const listId = useId();
  const ownRef = useRef<HTMLInputElement>(null);
  const fieldRef = inputRef ?? ownRef;
  // Keyed by its query, so a new query starts on the first row.
  const [active, setActive] = useState({ query, index: 0 });
  const activeIndex = Math.min(active.query === query ? active.index : 0, options.length - 1);
  const optionId = (index: number) => `${listId}-${index}`;

  // Null until measured on the client, which also keeps the portal out of the server render.
  const [placement, setPlacement] = useState<CSSProperties | null>(null);
  // Again on each new query or option list: a pick can move the field (a chip row above it grows).
  useLayoutEffect(() => {
    if (open) placeAgainst(fieldRef.current, setPlacement);
  }, [open, fieldRef, query, options]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => placeAgainst(fieldRef.current, setPlacement);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, fieldRef]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        if (!open) return onOpenChange(true);
        if (options.length === 0) return;
        const step = e.key === "ArrowDown" ? 1 : -1;
        return setActive({ query, index: (activeIndex + step + options.length) % options.length });
      }
      case "Enter": {
        e.preventDefault();
        if (open && options[activeIndex]) return onPick(options[activeIndex]);
        const text = query.trim();
        if (onSubmitText && text) onSubmitText(text);
        return;
      }
      case "Escape":
        if (open) {
          e.preventDefault();
          onOpenChange(false);
        }
    }
  };

  return (
    <div className="w-full">
      <Input
        ref={fieldRef}
        id={id}
        aria-label={ariaLabel}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && options[activeIndex] ? optionId(activeIndex) : undefined}
        value={query}
        onChange={(e) => {
          onQueryChange(e.target.value);
          onOpenChange(true);
        }}
        onFocus={() => onOpenChange(true)}
        onBlur={() => onOpenChange(false)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
        autoFocus={autoFocus}
        invalid={invalid}
        className={className}
      />
      {open &&
        placement &&
        createPortal(
          <div
            // Keeps focus in the field, so a click on a row lands before the blur closes the list.
            onMouseDown={(e) => e.preventDefault()}
            style={placement}
            className={cn("z-[2000] overflow-y-auto rounded-md p-1", TOOLTIP_SURFACE)}
          >
            <ul id={listId} role="listbox" aria-label={ariaLabel} className="space-y-0.5">
              {options.map((option, index) => (
                <li
                  key={optionKey(option)}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === activeIndex}
                  onClick={() => onPick(option)}
                  onMouseEnter={() => setActive({ query, index })}
                  className={cn(ROW, index === activeIndex && "bg-neutral-700")}
                >
                  {pillOption?.(option) ? (
                    <Pill className="min-w-0">{renderOption(option)}</Pill>
                  ) : (
                    renderOption(option)
                  )}
                </li>
              ))}
            </ul>
            {status && (
              <p role="status" className={STATUS_ROW}>
                {status}
              </p>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
