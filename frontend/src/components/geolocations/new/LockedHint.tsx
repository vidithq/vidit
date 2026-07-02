import type { ReactNode } from "react";
import { Lock } from "lucide-react";

/** Small "this field is read-only" marker next to a locked field's label. The
 *  default reads "from bounty" (a bounty-fulfilment source URL); pass children
 *  for another locked field (e.g. a detection's provenance URL). */
export function LockedHint({ children }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 ml-1.5 text-[10px] normal-case tracking-normal text-neutral-500">
      <Lock size={10} />
      {children ?? "from bounty"}
    </span>
  );
}
