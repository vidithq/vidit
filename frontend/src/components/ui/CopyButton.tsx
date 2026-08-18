"use client";

import type { ComponentType } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "./Button";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";

/**
 * The one copy-to-clipboard control: a square ghost icon button whose resting
 * glyph flips to a check for the flash window, on `useCopyToClipboard`.
 *
 * Every icon-shaped copy affordance is this component (the event share row, the
 * profile's Discord account), so the gesture and its feedback can't drift. A
 * call site needing a different shape (the admin invite row copies a code from
 * a text button) composes `useCopyToClipboard` directly instead.
 *
 * `icon` swaps the resting glyph where the value names itself better than a
 * generic copy mark does (the Discord button carries the brand mark). The check
 * is fixed: what confirms the write has to read the same everywhere.
 *
 * Accessibility: the button's name is static (`label`), because a name that
 * changes on click is re-announced as a new control. The "copied" feedback is
 * a sibling live region instead, so a screen reader hears one name plus one
 * status update rather than the element renaming itself.
 *
 * `value` is a getter, not a string, so a call site can read `window` at click
 * time without a render-time branch.
 */
export function CopyButton({
  value,
  label,
  copiedLabel = "Link copied",
  icon: Icon = Copy,
  title,
  className,
  beforeCopy,
}: {
  /** The text to write, resolved at click time. */
  value: () => string;
  /** The button's accessible name; stays constant across the copied flash. */
  label: string;
  /** Resting glyph, any icon taking a pixel `size`: a lucide icon, or a brand
   *  mark from [`BrandGlyphs`](./BrandGlyphs.tsx). Defaults to the copy mark. */
  icon?: ComponentType<{ size?: number }>;
  /** Announced by the live region once the write lands. */
  copiedLabel?: string;
  /** Tooltip; defaults to `label`. A caller with its own states passes theirs. */
  title?: string;
  /** Orthogonal extras (an armed-state ring, spacing). */
  className?: string;
  /** Gate for a call site that must approve the write first (the event share
   *  row arms a draft link on the first click). Return `false` to swallow the
   *  click, `true` to let the copy proceed. */
  beforeCopy?: () => boolean;
}) {
  const { copied, copy } = useCopyToClipboard();

  const handleClick = () => {
    if (beforeCopy && !beforeCopy()) return;
    void copy(value());
  };

  return (
    <>
      <Button
        icon
        variant="ghost"
        onClick={handleClick}
        aria-label={label}
        title={copied ? copiedLabel : (title ?? label)}
        className={className}
      >
        {copied ? <Check size={15} /> : <Icon size={15} />}
      </Button>
      {/* Sibling, not a child: as the button's own name it would re-announce
          the control on every flip instead of reporting a status. */}
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? copiedLabel : ""}
      </span>
    </>
  );
}
