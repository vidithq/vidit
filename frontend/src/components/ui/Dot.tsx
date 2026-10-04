import { cn } from "@/lib/cn";

/**
 * The orange notification dot ("new content awaits" / "live"). Decorative;
 * position, ring and size come via `className` (`cn`, caller wins).
 */
export function Dot({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-1.5 rounded-full bg-orange-500", className)}
    />
  );
}
