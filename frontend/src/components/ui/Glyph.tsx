"use client";

import type { ComponentType } from "react";

/** The one size for an inline glyph. Small enough to sit inside a line of text
 *  without leading it, large enough that lucide's strokes stay legible. */
const GLYPH_SIZE = 13;

// The box every glyph occupies, whatever state it is in: a 24px square with the
// mark centred in it. One figure for both states, so a mark that lands or goes
// inert never moves the line it sits in. It is `<Button icon>`'s square at a
// smaller stop, which is what lets a glyph and an icon button read as the same
// family of control at two weights.
const GLYPH_BOX =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-md";

// The two colour states, private to this file: the primitive below is what
// picks between them, so a call site reaches for `<Glyph>` rather than for a
// class string. Accent is the accent every clickable on the site carries, so an
// acting mark and a link read as the same offer.
//
// One hover for every active glyph, link and button alike, and it is `<Button>`
// ghost's: the accent lightens and a tinted plate comes up under the mark.
// `TEXT_LINK`'s own hover is an underline, which a mark carrying no text cannot
// show, so a glyph would answer the pointer on a text link and stay dead on an
// icon. The plate is the same answer a ghost button gives, so the two quiet
// controls on the site react alike, and it is the same rise whichever element
// the mark renders as, so a reader cannot tell a navigating mark from an acting
// one by how it answers.
//
// Grey here is a state, not a dimmed accent: a control is accent when it acts
// and neutral grey when it cannot, so an inert glyph reads as inert instead of
// as a faint version of a link. It takes no hover and no plate at all, since
// nothing there answers, and it keeps the same 24px box, so nothing shifts. The
// same rule paints <Button>'s disabled state. Spacing stays at the call site,
// since a glyph sits in whatever line of text carries it.
const ACTION_GLYPH = `${GLYPH_BOX} text-orange-400 transition-colors hover:bg-orange-500/10 hover:text-orange-300`;
const MUTED_GLYPH = `${GLYPH_BOX} text-neutral-600`;

/**
 * The one compact glyph control: a 13px mark centred in a 24px square that
 * lights up on hover, which is `<Button>` ghost at a smaller stop.
 *
 * The shape a control takes when it belongs to a line rather than to an action
 * row: the archived-copy mark beside a source link, the map and copy marks on a
 * coordinates line and beside the coordinate fields. A full icon button in those
 * places outweighs the text it serves and, beside a field, takes width from it,
 * so the glyph keeps the ghost treatment and shrinks the square. Where a control
 * owns the full box, that is `<Button icon>`.
 *
 * Colour is the state, and the primitive is what makes that true: it paints
 * accent only when it renders something a reader can act on, and neutral grey
 * otherwise, so a glyph cannot be accent and inert or grey and clickable. `active` is the call site's half of that (a map link with no
 * coordinate pair to open, a copy with nothing to write), and the primitive
 * covers the rest: an inactive glyph renders as an inert `<span>` whatever
 * `href` or `onClick` it was handed, so nothing navigates or fires from a mark
 * that reads as unavailable.
 *
 * One of `href` (an outbound link, opened in a new tab) or `onClick` (an action
 * on this page) makes it a control; neither is a mark that only states
 * something, like a copy that does not exist. An active glyph answers the
 * pointer the same way in both forms, by lightening its accent under a tinted
 * plate, so no mark on the site is a control that fails to react; an inert one
 * takes no hover and no plate, and holds the same square so the line is still.
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
