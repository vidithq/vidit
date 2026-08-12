"use client";

import { CopyButton } from "@/components/ui/CopyButton";

/**
 * Copy the profile's public URL. The share affordance for a page an analyst
 * pins in a bio: the link they need is the one they are looking at, so the
 * control hands it over in one click.
 *
 * The control itself is the shared `<CopyButton>`, the same one the event
 * share row uses, so the gesture reads the same wherever a Vidit URL is
 * shared.
 */
export function CopyProfileLink({ username }: { username: string }) {
  return (
    <CopyButton
      value={() => `${window.location.origin}/profile/${username}`}
      label="Copy profile link"
    />
  );
}
