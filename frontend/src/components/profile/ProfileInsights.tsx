"use client";

import { SOURCE_KIND_LABELS, type SourceKind } from "@/lib/sources";
import { useEffect, useState } from "react";
import { Bot, Camera, MapPin, Swords } from "lucide-react";

import { profileSearchHref } from "@/lib/search";
import { getUserStats, type UserStats } from "@/lib/users";
import { ActivityHeatmap } from "@/components/ui/ActivityHeatmap";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SourceHostBar } from "@/components/ui/SourceHostBar";
import { StatGrid, StatTile } from "@/components/ui/StatTile";

/**
 * The shape-of-work section on the public profile: two live-status counts and the leading conflict
 * and source kind as four tiles, the source-origin bar, and the month grid, all from
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
 * with nothing to explain the gap. No block carries a helper line: a heading's `?` holds its
 * definition.
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

  // The head of each ranked list (ordered count desc then name server-side), all the card prints.
  const topConflict = stats.top_conflicts[0];
  const topKind = stats.source_kinds[0];

  return (
    <Card as="section">
      <SectionEyebrow title="Insights" margin="none" />

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
          label="Top source kind"
          small
          value={topKind ? (SOURCE_KIND_LABELS[topKind.name as SourceKind] ?? topKind.name) : "None"}
          href={topKind ? profileSearchHref(username, { source_kind: topKind.name }) : undefined}
        />
      </StatGrid>

      {/* Where the footage came from: the beat an analyst works reads off the hosts. The `?` is the
          source links definition, not to be confused with the source kind above. */}
      <div>
        <SectionEyebrow title="Source origin" concept="source_links" as="h3" margin="sm" />
        <SourceHostBar
          hosts={stats.source_hosts}
          otherCount={stats.other_hosts_count}
          noSourceCount={stats.no_source_count}
        />
      </div>

      {/* The axis is the date the event happened, not when it was posted or imported. The heading is
          the name the field carries on the submit and edit forms; its `?` settles the ambiguity. */}
      <div>
        <SectionEyebrow title="Event dates" concept="occurred_date" as="h3" margin="sm" />
        <ActivityHeatmap buckets={stats.activity} />
      </div>
    </Card>
  );
}
