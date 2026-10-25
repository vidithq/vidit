import type { ReactNode } from "react";
import { Lock } from "lucide-react";

/** Marker next to a locked field's label. Defaults to "from request"; pass
 *  children for another locked field (a detection's provenance URL). */
export function LockedHint({ children }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 ml-1.5 text-[10px] normal-case tracking-normal text-neutral-500">
      <Lock size={10} />
      {children ?? "from request"}
    </span>
  );
}
