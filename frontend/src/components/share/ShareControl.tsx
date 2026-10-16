"use client";

import { useSyncExternalStore } from "react";
import { Share2 } from "lucide-react";

import { ARM_MS, useConfirmAction } from "@/hooks/useConfirmAction";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { CopyButton } from "@/components/ui/CopyButton";
import { ARMED_RING } from "@/components/ui/styles";

const subscribeNever = () => () => {};
const hasWebShare = () => typeof navigator.share === "function";
// The server render has no navigator; hydration reads the browser's answer.
const noWebShare = () => false;

/**
 * Passing a record on in one click. Where the browser has the Web Share API, **Share** opens the
 * device's share sheet with the page's address and title. Elsewhere it copies the address, and the
 * mark turns into a check (`CopyButton`, the app's one copy confirmation). `caveat` marks a record
 * that may still change: the share then takes a confirming second click.
 */
export function ShareControl({
  path,
  title,
  caveat,
}: {
  /** The record's own page on this origin, such as `/events/{id}`. */
  path: string;
  title: string;
  caveat?: string;
}) {
  const webShare = useSyncExternalStore(subscribeNever, hasWebShare, noWebShare);
  const { copied, copy } = useCopyToClipboard();
  const share = () => {
    const url = `${window.location.origin}${path}`;
    if (webShare) {
      // The reader dismissing the sheet rejects the promise; there is nothing to report.
      navigator.share({ title, url }).catch(() => {});
    } else {
      void copy(url);
    }
  };
  const { armed, trigger } = useConfirmAction(share, { timeoutMs: ARM_MS });

  return (
    <div className="flex items-center gap-1.5">
      {/* Always mounted, so the armed nudge is announced; the button keeps its name. */}
      <span role="status" className="text-[10px] text-neutral-400 empty:hidden">
        {armed ? `${caveat} Click again to share.` : ""}
      </span>
      <CopyButton
        label="Share"
        announce="Link copied"
        icon={<Share2 size={14} />}
        copied={copied}
        onClick={caveat ? trigger : share}
        className={armed ? ARMED_RING : ""}
      />
    </div>
  );
}
