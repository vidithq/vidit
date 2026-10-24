import { WARNING_CALLOUT } from "@/components/ui/styles";
import { cn } from "@/lib/cn";
import { safeHostname } from "@/lib/format";
import type { SourceWarning } from "@/lib/sources";

/**
 * What keeps a reader from reopening a satellite or aircraft image (`SourceRead.warnings`, or
 * `POST /sources/check` in a form): one amber line per warning, led by the host of the link it
 * is about. They block nothing. Renders nothing without a warning.
 */
export function SourceWarnings({ warnings, label }: { warnings: SourceWarning[]; label: string }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="space-y-1.5" aria-label={label}>
      {warnings.map((warning, i) => (
        <li
          key={`${warning.code} ${warning.url ?? ""} ${i}`}
          className={cn("rounded-md px-3 py-2 text-xs", WARNING_CALLOUT)}
        >
          {warning.url && <span className="font-medium">{safeHostname(warning.url)}: </span>}
          {warning.message}
        </li>
      ))}
    </ul>
  );
}
