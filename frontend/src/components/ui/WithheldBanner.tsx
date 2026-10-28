import { cn } from "@/lib/cn";
import { formatInstant } from "@/lib/format";
import { WARNING_CALLOUT } from "./styles";

/** The banner under the header of an item a moderator withheld (`hidden_at`). Only an admin reads a
 *  withheld item, so only an admin meets it. */
export function WithheldBanner({
  since,
  noun,
}: {
  since: string;
  noun: "event" | "collection" | "site";
}) {
  return (
    <p role="status" className={cn("rounded-lg px-4 py-3 text-sm", WARNING_CALLOUT)}>
      Withheld since {formatInstant(since)}. Only admins read this {noun} until it is restored.
    </p>
  );
}
