"use client";

import { useEffect, useState } from "react";
import { Archive, Film, MapPin, Radar } from "lucide-react";

import { getUserStats, type UserStats } from "@/lib/users";
import { ActivityBars } from "@/components/ui/ActivityBars";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { StatGrid, StatTile } from "@/components/ui/StatTile";

/**
 * The shape-of-work section on the public profile: status split, media
 * count, top conflict + capture-source pills, and the 12-month activity
 * bars, all from `GET /users/{username}/stats`. Renders nothing until the
 * stats arrive and nothing at all for a profile with no events; a failed
 * fetch also hides the section rather than blocking the profile.
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

  return (
    <Card as="section">
      <SectionEyebrow title="Insights" as="h3" margin="none" />

      <StatGrid>
        <StatTile icon={MapPin} label="Geolocated" value={stats.geolocated_count} />
        <StatTile icon={Radar} label="Detected" value={stats.detected_count} />
        <StatTile icon={Archive} label="Closed" value={stats.closed_count} />
        <StatTile icon={Film} label="Media" value={stats.media_count} />
      </StatGrid>

      {stats.top_conflicts.length > 0 && (
        <div>
          <SectionEyebrow title="Top conflicts" as="h4" margin="sm" />
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
          <SectionEyebrow title="Capture sources" as="h4" margin="sm" />
          <div className="flex flex-wrap gap-1.5">
            {stats.capture_sources.map((t) => (
              <Pill key={t.name}>
                {t.name} · {t.count}
              </Pill>
            ))}
          </div>
        </div>
      )}

      <div>
        <SectionEyebrow title="Last 12 months" as="h4" margin="sm" />
        <ActivityBars buckets={stats.monthly_activity} />
      </div>
    </Card>
  );
}
