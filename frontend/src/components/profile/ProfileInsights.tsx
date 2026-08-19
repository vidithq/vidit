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
 * The shape-of-work section on the public profile: the two live-status counts
 * and the leading conflict and capture source as four tiles, the source-origin
 * bar, and the month grid over the span the analyst's events cover, all from
 * `GET /users/{username}/stats`. Renders nothing until the stats arrive and
 * nothing at all for a profile with no events; a failed fetch also hides the
 * section rather than blocking the profile.
 *
 * It is the only home for the work figures on the page: the identity line
 * above carries the social and account metadata, and nothing restates
 * `Geolocated` under a second name. Each tile names its figure once: the
 * ranked lists behind the two leaders are not printed beside them, since the
 * tile already says who leads and the search behind it says by how much.
 *
 * A tile is the way into the rows it counts. Every one carries a
 * `profileSearchHref` into `/search` scoped to this analyst, so the reader who
 * wants to check a figure lands on the events it was summed off. A tile with
 * no value to name (`None`) carries no link, because there is nothing to open.
 *
 * One population feeds every block: the analyst's live events in the three
 * worked statuses, detections included. A chart drawn on published work alone
 * beside tiles counting detections would print two answers to one question with
 * nothing on the page to explain the gap, so the backend serves one set. Each
 * note says what its own block makes of that set, because the blocks do not
 * all draw the whole of it: the month grid can only draw the events that carry
 * a date.
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

  // The head of each ranked list, which is all the card prints of it. Both
  // lists are ordered count desc then name server-side, so the first row is
  // the leader.
  const topConflict = stats.top_conflicts[0];
  const topCaptureSource = stats.capture_sources[0];

  return (
    <Card as="section">
      <div>
        <SectionEyebrow title="Insights" margin="none" />
        {/* The tiles' population, stated once. It is not every figure on the
            card: the month grid draws only the dated events, which its own
            note says. */}
        <ChartNote>
          The tiles below read one set of {stats.total_events}{" "}
          {stats.total_events === 1 ? "event" : "events"}: this analyst&apos;s
          geolocations, machine detections and closed rows. Two count it, two
          name what leads it.
        </ChartNote>
      </div>

      <StatGrid>
        <StatTile
          icon={MapPin}
          label="Geolocated"
          value={stats.geolocated_count}
          href={profileSearchHref(username, { status: "geolocated" })}
        />
        {/* Bot, not a new glyph: the one detected marker across the app
            (StatusBadge, DetectionsEntry). */}
        <StatTile
          icon={Bot}
          label="Detected"
          value={stats.detected_count}
          href={profileSearchHref(username, { status: "detected" })}
        />
        {/* `small`: a conflict name is a title ("Russo-Ukrainian War"), not a
            figure, and the tile has to hold it at 375 px. */}
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
