"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Archive, Bot, Film, MapPin } from "lucide-react";

import { getUserStats, type UserStats } from "@/lib/users";
import { ActivityHeatmap } from "@/components/ui/ActivityHeatmap";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SourceHostBar } from "@/components/ui/SourceHostBar";
import { StatGrid, StatTile } from "@/components/ui/StatTile";

/**
 * The line under a heading saying what the block below it counts: the card's
 * own population line, and one per chart. Local to this card and deliberately
 * not a `components/ui/` export: it is prose in the card's own voice, not a
 * control, and a section's *help* stays the `?` beside the heading
 * (`<FieldHelp>`, the one explanation affordance). A heading here names a
 * chart in three or four words, which leaves the population it counts
 * unstated; the note states it without asking the reader to open anything.
 */
function ChartNote({ children }: { children: ReactNode }) {
  return <p className="mt-1 mb-2 text-xs text-neutral-500">{children}</p>;
}

/**
 * The shape-of-work section on the public profile: status split, media
 * count, top conflict + capture-source pills, the source-origin bar, and the
 * month grid over the span the analyst's events cover, all from
 * `GET /users/{username}/stats`. Renders nothing until the stats arrive and
 * nothing at all for a profile with no events; a failed fetch also hides the
 * section rather than blocking the profile.
 *
 * It is the only home for the work figures on the page: the identity line
 * above carries the social and account metadata, and nothing restates
 * `Geolocated` under a second name.
 *
 * One population feeds every block: the analyst's live events in the three
 * worked statuses, detections included. A chart drawn on published work alone
 * beside tiles counting detections would print two answers to one question with
 * nothing on the page to explain the gap, so the backend serves one set. Each
 * note says what its own block makes of that set, because the blocks do not
 * all count events: `Media` counts the media hanging off them, and the month
 * grid can only draw the events that carry a date.
 */
export function ProfileInsights({ username }: { username: string }) {
  // The result remembers which username it answers, so navigating to another
  // profile never paints stale stats while the new fetch is in flight.
  const [result, setResult] = useState<{ username: string; stats: UserStats } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getUserStats(username)
      .then((stats) => {
        if (!cancelled) setResult({ username, stats });
      })
      .catch(() => {
        // Deliberately swallowed: see the component doc.
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  const stats = result?.username === username ? result.stats : null;

  if (!stats || stats.total_events === 0) {
    return null;
  }

  // Summed off the buckets rather than taken from `total_events`: an undated
  // event gets no bucket and the span stops at ten years, so the grid's own
  // sum is the only figure that matches the cells on screen.
  const datedCount = stats.activity.reduce((sum, bucket) => sum + bucket.count, 0);

  return (
    <Card as="section">
      <div>
        <SectionEyebrow title="Insights" margin="none" />
        {/* The tiles' population, stated once. It is not every figure on the
            card: `Media` counts media rows rather than events, and the month
            grid draws only the dated ones, which its own note says. */}
        <ChartNote>
          The tiles below describe one set of {stats.total_events}{" "}
          {stats.total_events === 1 ? "event" : "events"}: this analyst&apos;s
          geolocations, machine detections and closed rows.
        </ChartNote>
      </div>

      <StatGrid>
        <StatTile icon={MapPin} label="Geolocated" value={stats.geolocated_count} />
        {/* Bot, not a new glyph: the one detected marker across the app
            (StatusBadge, DetectionsEntry). */}
        <StatTile icon={Bot} label="Detected" value={stats.detected_count} />
        <StatTile icon={Archive} label="Closed" value={stats.closed_count} />
        <StatTile icon={Film} label="Media" value={stats.media_count} />
      </StatGrid>

      {stats.top_conflicts.length > 0 && (
        <div>
          <SectionEyebrow title="Top conflicts" as="h3" margin="sm" />
          <div className="flex flex-wrap gap-1.5">
            {stats.top_conflicts.map((c) => (
              <Pill key={c.name} tone="accent">
                {c.name} · {c.count}
              </Pill>
            ))}
          </div>
        </div>
      )}

      {stats.capture_sources.length > 0 && (
        <div>
          <SectionEyebrow title="Capture sources" as="h3" margin="sm" />
          <div className="flex flex-wrap gap-1.5">
            {stats.capture_sources.map((t) => (
              <Pill key={t.name}>
                {t.name} · {t.count}
              </Pill>
            ))}
          </div>
        </div>
      )}

      {/* Where the footage came from, next to what it shows and how it was
          shot: the beat an analyst works reads off the hosts. The `?` is the
          `source_url` definition, so "source" here can't be confused with the
          capture source above, which is the lens rather than the platform. */}
      <div>
        <SectionEyebrow title="Source origin" concept="source_url" as="h3" margin="none" />
        <ChartNote>
          The host of each event&apos;s source link. Events naming no source
          have their own share.
        </ChartNote>
        <SourceHostBar
          hosts={stats.source_hosts}
          otherCount={stats.other_hosts_count}
          noSourceCount={stats.no_source_count}
        />
      </div>

      {/* The axis is the date the event happened, not when the analyst posted
          or imported it. The heading is the name the field already carries on
          the submit and edit forms, so one concept keeps one name across the
          app, and the note settles the ambiguity outright, so the reading does
          not depend on opening the `?`; the `?` still carries the registry's
          definition of the field. */}
      <div>
        <SectionEyebrow title="Event dates" concept="event_date" as="h3" margin="none" />
        <ChartNote>
          The month each event took place, not when it was posted, imported or
          published. It covers the {datedCount}{" "}
          {datedCount === 1 ? "event" : "events"} dated in the years shown.
        </ChartNote>
        <ActivityHeatmap buckets={stats.activity} />
      </div>
    </Card>
  );
}
