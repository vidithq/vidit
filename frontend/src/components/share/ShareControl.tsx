"use client";

import { useSyncExternalStore } from "react";
import { Link2, Share2 } from "lucide-react";

import { ARM_MS, useConfirmAction } from "@/hooks/useConfirmAction";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Button } from "@/components/ui/Button";
import { XGlyph } from "@/components/ui/BrandGlyphs";
import { ARMED_RING } from "@/components/ui/styles";
import { openShareIntent } from "@/components/share/ShareOnX";

const subscribeNever = () => () => {};
const hasWebShare = () => typeof navigator.share === "function";
// The server render has no navigator: it renders the menu, and hydration swaps in the native
// sheet where the browser has one.
const noWebShare = () => false;

/**
 * Passing a record on. Where the browser has the Web Share API, **Share** opens the device's share
 * sheet with the page's address and title. Elsewhere it opens a menu with **Copy link** and
 * **Share on X** (the X intent, prefilled with `lines`). `caveat` marks a record that may still
 * change: the share sheet then takes a confirming second click, and the menu prints the caveat
 * above its items.
 */
export function ShareControl({
  path,
  title,
  lines,
  caveat,
}: {
  /** The record's own page on this origin, such as `/events/{id}`. */
  path: string;
  title: string;
  /** The X post body, one line per entry. */
  lines: string[];
  caveat?: string;
}) {
  const webShare = useSyncExternalStore(subscribeNever, hasWebShare, noWebShare);
  const { copied, copy } = useCopyToClipboard();
  const nativeShare = () => {
    // The reader dismissing the sheet rejects the promise; there is nothing to report.
    navigator.share({ title, url: `${window.location.origin}${path}` }).catch(() => {});
  };
  const { armed, trigger } = useConfirmAction(nativeShare, { timeoutMs: ARM_MS });

  const status = armed ? `${caveat} Click again to share.` : copied ? "Link copied" : "";

  return (
    <div className="flex items-center gap-1.5">
      {/* Always mounted, so a change is announced; the button keeps its name. */}
      <span role="status" className="text-[10px] text-neutral-400 empty:hidden">
        {status}
      </span>
      {webShare ? (
        <Button
          variant="ghost"
          onClick={caveat ? trigger : nativeShare}
          className={armed ? ARMED_RING : ""}
        >
          <Share2 size={14} />
          Share
        </Button>
      ) : (
        <ActionMenu
          label="Share"
          showLabel
          icon={<Share2 size={14} />}
          note={caveat}
          items={[
            {
              key: "copy",
              label: "Copy link",
              icon: <Link2 size={14} />,
              onSelect: () => void copy(`${window.location.origin}${path}`),
            },
            {
              key: "x",
              label: "Share on X",
              icon: <XGlyph size={14} />,
              onSelect: () => openShareIntent(path, lines),
            },
          ]}
        />
      )}
    </div>
  );
}
