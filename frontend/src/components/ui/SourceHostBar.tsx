import type { components } from "@/lib/api-types";
import { Pill } from "./Pill";
import { ACCENT_RAMP, CHART_NEUTRAL, CHART_TAIL } from "./styles";

/** One (host, count) entry of the breakdown, aliased from the generated
 *  schema rather than restated (the single-source rule: payload types come
 *  from the OpenAPI spec). It is the shape `source_hosts` carries, where
 *  `name` is the host, already folded to lower case with any leading `www.`
 *  removed server side. */
export type SourceHostCount = components["schemas"]["TagCount"];

interface Segment {
  key: string;
  label: string;
  count: number;
  paint: string;
}

/**
 * One stacked horizontal bar breaking a body of work down by where its
 * footage came from, with a legend naming every slice.
 *
 * Hosts arrive ranked and already capped, so the ramp reads top to bottom:
 * the widest slice takes the strongest accent step. Two slices sit outside
 * the ramp because they are not a host, and both stay visible rather than
 * being dropped, so the bar accounts for every event the caller counted: the
 * unnamed tail (`otherCount`) in `CHART_TAIL`, and the events naming no
 * readable source (`noSourceCount`) in the absence paint.
 *
 * The legend is the readable half. The bar carries proportion and nothing
 * else, so it is `aria-hidden`: a touch device has no hover to reveal a
 * `title` with, and a screen reader would otherwise meet the same figures
 * twice. Bare hosts, not platform names, because that is the vocabulary the
 * rest of the app shows a source under (`<SourceLabel>`) and a name registry
 * would print "Unknown" over exactly the long tail this chart exists to show.
 */
export function SourceHostBar({
  hosts,
  otherCount,
  noSourceCount,
}: {
  hosts: SourceHostCount[];
  otherCount: number;
  noSourceCount: number;
}) {
  const segments: Segment[] = [
    ...hosts.map((host, i) => ({
      key: host.name,
      label: host.name,
      count: host.count,
      // Clamped rather than trusted: the ramp has five steps, and a caller
      // handing over a longer list gets a flat tail instead of `undefined`.
      paint: ACCENT_RAMP[Math.min(i, ACCENT_RAMP.length - 1)],
    })),
    ...(otherCount > 0
      ? [{ key: "other", label: "Other", count: otherCount, paint: CHART_TAIL }]
      : []),
    ...(noSourceCount > 0
      ? [
          {
            key: "no-source",
            label: "No source",
            count: noSourceCount,
            paint: CHART_NEUTRAL,
          },
        ]
      : []),
  ];

  if (segments.length === 0) {
    return <p className="text-xs text-neutral-500">No event names a source yet.</p>;
  }

  return (
    <div>
      <div className="flex h-2 w-full overflow-hidden rounded-full" aria-hidden="true">
        {segments.map((segment) => (
          <div
            key={segment.key}
            className={segment.paint}
            // Proportional widths with a floor, so a one-event host stays a
            // visible sliver instead of rounding away to nothing.
            style={{ flexGrow: segment.count, flexBasis: 0, minWidth: "3px" }}
          />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-1.5 list-none">
        {segments.map((segment) => (
          <li key={segment.key}>
            <Pill
              icon={
                // The hairline ring is what keeps the absence paint legible:
                // the neutral pill it sits in is the same value, so an
                // unringed "No source" swatch would vanish into its chip. The
                // ring is the neutral border the pill and the card already
                // carry, so it repoints with the theme.
                <span
                  className={`size-2 shrink-0 rounded-full ring-1 ring-neutral-700 ${segment.paint}`}
                  aria-hidden="true"
                />
              }
            >
              {segment.label} · {segment.count}
            </Pill>
          </li>
        ))}
      </ul>
    </div>
  );
}
