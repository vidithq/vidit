"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Bot, Camera, MapPin, Swords } from "lucide-react";

import { profileSearchHref } from "@/lib/search";
import { getUserStats, type UserStats } from "@/lib/users";
import { ActivityHeatmap } from "@/components/ui/ActivityHeatmap";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SourceHostBar } from "@/components/ui/SourceHostBar";
import { StatGrid, StatTile } from "@/components/ui/StatTile";

/** The line under a heading saying what the block counts. Local to this card, not a
 * `components/ui/` export: it is prose in the card's voice, and a section's help stays the `?`
 * (`<FieldHelp>`). It states the population a short heading leaves unsaid. */
function ChartNote({ children }: { children: ReactNode }) {
  return <p className="mt-1 mb-2 text-xs text-neutral-500">{children}</p>;
}

/**
 * The shape-of-work section on the public profile: two live-status counts and the leading conflict
 * and capture source as four tiles, the source-origin bar, and the month grid, all from
 * `GET /users/{username}/stats`. Renders nothing until stats arrive, for a profile with no events,
 * or after a failed fetch (it never blocks the profile).
 *
 * The only home for the work figures: the identity line carries social and account metadata. Each
 * tile names its figure once; the ranked lists behind the leaders aren't printed.
 *
 * Every tile links into `/search` scoped to this analyst via `profileSearchHref`, so a reader can
 * check a figure on the events it was summed off. A tile with no value (`None`) carries no link.
 *
 * One population feeds every block: the live `geolocated` and `detected` events, detections
 * included. Charts on published work beside tiles counting detections would print two answers
 * with nothing to explain the gap. Each note says what its block makes of the set (the month grid
 * draws only dated events).
 */
export function ProfileInsights({ username }: { username: string }) {
  // The result remembers which username it answers, so navigating never paints stale stats.
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

  // Summed off the buckets, not `total_events`: an undated event gets no bucket and the span stops
  // at ten years, so the grid's sum is the only figure matching the cells on screen.
  const datedCount = stats.activity.reduce((sum, bucket) => sum + bucket.count, 0);

  // The head of each ranked list (ordered count desc then name server-side), all the card prints.
  const topConflict = stats.top_conflicts[0];
  const topCaptureSource = stats.capture_sources[0];

  return (
    <Card as="section">
      <div>
        <SectionEyebrow title="Insights" margin="none" />
        {/* The tiles' population, stated once. Not every figure here: the month grid draws only dated
            events, as its note says. */}
        <ChartNote>
          The tiles below read one set of {stats.total_events}{" "}
          {stats.total_events === 1 ? "event" : "events"}: this analyst&apos;s
          geolocations and machine detections. Two count it, two name what
          leads it.
        </ChartNote>
      </div>

      <StatGrid>
        <StatTile
          icon={MapPin}
          label="Geolocated"
          value={stats.geolocated_count}
          href={profileSearchHref(username, { status: "geolocated" })}
        />
        {/* Bot, the one detected marker across the app (StatusBadge, DetectionsEntry). */}
        <StatTile
          icon={Bot}
          label="Detected"
          value={stats.detected_count}
          href={profileSearchHref(username, { status: "detected" })}
        />
        {/* `small`: a conflict name is a title ("Russo-Ukrainian War"), and the tile must hold it at 375 px. */}
        <StatTile
          icon={Swords}
          label="Top conflict"
          small
          value={topConflict ? topConflict.name : "None"}
          href={
            topConflict
              ? profileSearchHref(username, { conflict: topConflict.name })
              : undefined
          }
        />
        <StatTile
          icon={Camera}
          label="Top capture source"
          small
          value={topCaptureSource ? topCaptureSource.name : "None"}
          href={
            topCaptureSource
              ? profileSearchHref(username, {
                  capture_source: topCaptureSource.name,
                })
              : undefined
          }
        />
      </StatGrid>

      {/* Where the footage came from: the beat an analyst works reads off the hosts. The `?` is the
          `source_url` definition, not to be confused with the capture source above. */}
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

      {/* The axis is the date the event happened, not when it was posted or imported. The heading is
          the name the field carries on the submit and edit forms; the note settles the ambiguity so the
          reading doesn't depend on the `?`. */}
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
