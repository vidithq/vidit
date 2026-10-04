import type { components } from "@/lib/api-types";
import { Pill } from "./Pill";
import { ACCENT_RAMP, CHART_NEUTRAL, CHART_TAIL } from "./styles";

/** One (host, count) entry of `source_hosts`; `name` is the host, lower-cased with
 *  any leading `www.` removed server side. */
export type SourceHostCount = components["schemas"]["TagCount"];

interface Segment {
  key: string;
  label: string;
  count: number;
  paint: string;
}

/**
 * One stacked horizontal bar breaking a body of work down by footage source,
 * with a legend naming every slice.
 *
 * Hosts arrive ranked and capped, so the widest slice takes the strongest accent
 * step. Two slices sit outside the ramp and stay visible, so the bar accounts
 * for every counted event: the unnamed tail (`otherCount`, `CHART_TAIL`) and
 * events with no readable source (`noSourceCount`, the absence paint).
 *
 * The bar carries proportion only and is `aria-hidden` (touch has no hover for
 * a `title`, and a screen reader would hear the figures twice); the legend is
 * the readable half. Bare hosts, not platform names, matching `<SourceLabel>`;
 * a name registry would print "Unknown" over the long tail.
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
      // Clamped: a list longer than the five ramp steps gets a flat tail.
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
            // The floor keeps a one-event host visible.
            style={{ flexGrow: segment.count, flexBasis: 0, minWidth: "3px" }}
          />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-1.5 list-none">
        {segments.map((segment) => (
          <li key={segment.key}>
            <Pill
              icon={
                // The ring keeps the absence swatch from vanishing into the
                // same-valued neutral pill.
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
