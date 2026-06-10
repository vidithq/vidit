import { Lock } from "lucide-react";

export function LockedHint() {
  return (
    <span className="inline-flex items-center gap-1 ml-1.5 text-[10px] normal-case tracking-normal text-neutral-500">
      <Lock size={10} />
      from bounty
    </span>
  );
}
