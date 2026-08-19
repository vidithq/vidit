"use client";

import type { ComponentType } from "react";

import { ACTION_GLYPH, MUTED_GLYPH } from "./styles";

/** The one size for an inline glyph. Small enough to sit inside a line of text
 *  without leading it, large enough that lucide's strokes stay legible. */
const GLYPH_SIZE = 13;

/**
 * The one bare inline glyph: a 13px mark set in a line of text, with no button
 * chrome around it.
 *
 * The shape a control takes when it belongs to a line rather than to an action
 * row: the archived-copy mark beside a source link, the map and copy marks on a
 * coordinates line and beside the coordinate fields. A square icon button in
 * those places outweighs the text it serves and, beside a field, takes width
 * from it. Where a control does own its own box, that is `<Button icon>`.
 *
 * Colour is the state, and the primitive is what makes that true: it paints
 * `ACTION_GLYPH` accent only when it renders something a reader can act on, and
 * `MUTED_GLYPH` grey otherwise, so a glyph cannot be accent and inert or grey
 * and clickable. `active` is the call site's half of that (a map link with no
 * coordinate pair to open, a copy with nothing to write), and the primitive
 * covers the rest: an inactive glyph renders as an inert `<span>` whatever
 * `href` or `onClick` it was handed, so nothing navigates or fires from a mark
 * that reads as unavailable.
 *
 * One of `href` (an outbound link, opened in a new tab) or `onClick` (an action
 * on this page) makes it a control; neither is a mark that only states
 * something, like a copy that does not exist.
 *
 * The glyph carries no text, so `label` is its whole name: it lands on both
 * `aria-label` and `title`, which is the bare name of an icon-only control
 * rather than an explanation (those are `<FieldHelp>`). A control whose tooltip
 * changes while its name must not (the copied flash) passes `title` itself.
 */
export function Glyph({
  icon: Icon,
  label,
  title,
  href,
  onClick,
  active = true,
  expanded,
}: {
  /** The mark, any icon taking a pixel `size`: a lucide glyph, or a brand mark
   *  from [`BrandGlyphs`](./BrandGlyphs.tsx). */
  icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
  /** The accessible name, and the tooltip unless `title` overrides it. Name the
   *  state as well as the target where a page carries several alike marks: a
   *  reader hearing "archived copy" twice cannot tell which link it belongs to,
   *  and one hearing "View on Maps" on a grey mark cannot tell it is inert. */
  label: string;
  /** Tooltip, for a control whose pointer text moves while its name holds
   *  still (the copy flash reads "Coordinates copied"). Defaults to `label`. */
  title?: string;
  /** Outbound target. Opens in a new tab, like every external link here. */
  href?: string;
  /** Action on this page. Use one of `href` / `onClick`, not both. */
  onClick?: () => void;
  /** False where the control has nothing to act on yet: grey, inert, and still
   *  occupying its width, so the line it sits in does not jump when it lands. */
  active?: boolean;
  /** For a glyph that toggles a disclosure: its `aria-expanded` state. */
  expanded?: boolean;
}) {
  const mark = <Icon size={GLYPH_SIZE} aria-hidden />;
  const tooltip = title ?? label;
  // Both halves of "can this be acted on": the call site's judgement, and
  // whether anything was handed over to act with.
  const acts = active && (href !== undefined || onClick !== undefined);

  if (acts && href !== undefined) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        title={tooltip}
        className={ACTION_GLYPH}
      >
        {mark}
      </a>
    );
  }

  if (acts && onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-expanded={expanded}
        title={tooltip}
        className={ACTION_GLYPH}
      >
        {mark}
      </button>
    );
  }

  // `img`, so the name is announced at all: a bare span carries none. It leaves
  // the tab order, since there is nothing here to reach, and it carries no
  // `aria-disabled`, which `img` does not support: this is a mark rather than a
  // control that refuses, so the state travels in the name the call site writes
  // ("No archived copy of the source").
  return (
    <span role="img" aria-label={label} title={tooltip} className={MUTED_GLYPH}>
      {mark}
    </span>
  );
}
