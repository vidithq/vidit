"use client";

import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";

/**
 * Copy the profile's public URL. The share affordance for a page an analyst
 * pins in a bio: the link they need is the one they are looking at, so the
 * control hands it over in one click.
 *
 * Same shape and behaviour as the copy button in the event share row
 * (`<Button icon variant="ghost">` flipping to a check), so the gesture reads
 * the same wherever a Vidit URL is shared.
 */
export function CopyProfileLink({ username }: { username: string }) {
  const { copied, copy } = useCopyToClipboard();

  // `window` is undefined during SSR; the function shape keeps this callable
  // from any render-time path even though the handler only fires in the
  // browser.
  const url = () =>
    typeof window === "undefined"
      ? `/profile/${username}`
      : `${window.location.origin}/profile/${username}`;

  return (
    <Button
      icon
      variant="ghost"
      onClick={() => void copy(url())}
      title={copied ? "Link copied" : "Copy profile link"}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
      {/* A bare icon needs an accessible name, and the label change isn't
          announced reliably without the live region. */}
      <span className="sr-only" aria-live="polite">
        {copied ? "Link copied" : "Copy profile link"}
      </span>
    </Button>
  );
}
