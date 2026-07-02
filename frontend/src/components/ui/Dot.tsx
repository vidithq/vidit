import { cn } from "@/lib/cn";

/**
 * The orange notification dot ("new content awaits" / "live"): sidebar nav
 * badges, the landing + closed-beta pills, the detections entry. Decorative
 * (`aria-hidden`); position, ring, and a larger size come via `className`
 * (`cn` caller-wins).
 */
export function Dot({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-1.5 rounded-full bg-orange-500", className)}
    />
  );
}
