import { ogCount, ogTruncate } from "@/lib/og";
import type { PublicProfile, UserStats } from "@/lib/users";

import {
  OG_COLOR,
  OG_CONTENT_TYPE,
  OG_SIZE,
  OgBadge,
  OgCard,
  ogFailedReadResponse,
  ogImageResponse,
} from "../../_og/card";
import { ogImageDataUri, ogFetch } from "../../_og/data";

// `og:image` for `/profile/{username}`: the analyst's portfolio as a share
// card. Reads the same two public payloads the page itself renders from, in
// parallel (`GET /users/{username}` for the identity and the follow counts,
// `GET /users/{username}/stats` for the shape of the work), so an unfurl costs
// one round of requests and never a chain of them. Both are anonymous reads of
// live rows only, which is what keeps the card inside the page's visibility:
// a soft-deleted analyst 404s upstream and lands on the fallback below.

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "An analyst's portfolio on Vidit: handle, geolocation count, and followers.";

/** Enough of a bio to place the analyst, cut before it can wrap past two lines. */
const BIO_MAX = 120;

/** Handle width the header can hold at its type size beside the avatar. */
const HANDLE_MAX = 20;

const AVATAR_PX = 160;

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", fontSize: "52px", color: OG_COLOR.text }}>{value}</div>
      <div
        style={{
          display: "flex",
          marginTop: "6px",
          fontSize: "20px",
          letterSpacing: "0.1em",
          color: OG_COLOR.muted,
        }}
      >
        {label.toUpperCase()}
      </div>
    </div>
  );
}

function Avatar({ src, username }: { src: string | null; username: string }) {
  const shared = {
    display: "flex" as const,
    width: `${AVATAR_PX}px`,
    height: `${AVATAR_PX}px`,
    borderRadius: "999px",
    border: `3px solid ${OG_COLOR.border}`,
    background: OG_COLOR.panel,
  };
  if (src) {
    // Satori draws `<img>`, not `next/image`: this tree is rasterised on the server.
    return <img src={src} alt="" width={AVATAR_PX} height={AVATAR_PX} style={{ ...shared, objectFit: "cover" }} />;
  }
  // Monogram fallback, as in `<Avatar>`: the handle's first character.
  return (
    <div style={{ ...shared, alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", fontSize: "72px", color: OG_COLOR.muted }}>
        {(username[0] ?? "?").toUpperCase()}
      </div>
    </div>
  );
}

function NotFoundCard({ username }: { username: string }) {
  return (
    <OgCard>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ display: "flex", fontSize: "72px", color: OG_COLOR.text }}>
          No analyst here
        </div>
        <div style={{ display: "flex", marginTop: "20px", fontSize: "30px", color: OG_COLOR.muted }}>
          {ogTruncate(`@${username}`, 40)} has no profile on Vidit.
        </div>
      </div>
    </OgCard>
  );
}

export default async function ProfileOpenGraphImage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const path = encodeURIComponent(username);

  const [profileRead, statsRead] = await Promise.all([
    ogFetch<PublicProfile>(`/users/${path}`),
    ogFetch<UserStats>(`/users/${path}/stats`),
  ]);

  if (profileRead.status === "missing") {
    return ogImageResponse(<NotFoundCard username={username} />);
  }
  // A failed read says nothing about the handle, so neither does the card.
  if (profileRead.status === "failed") {
    return ogFailedReadResponse();
  }

  const profile = profileRead.data;
  const stats = statsRead.status === "ok" ? statsRead.data : null;

  // The avatar URL arrives with the profile, so it is budgeted tighter; a miss costs the monogram, not the card.
  const avatar = await ogImageDataUri(profile.avatar_url);

  // The headline reads off the profile payload (equals `stats.geolocated_count`), so it survives a failed stats read; stats fill the caption and media tile.
  const conflicts = (stats?.top_conflicts ?? []).map((c) => c.name).join(" · ");

  return ogImageResponse(
    <OgCard badge={<OgBadge label="Analyst" />} caption={conflicts ? ogTruncate(conflicts, 60) : undefined}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <Avatar src={avatar} username={profile.username} />
          <div style={{ display: "flex", flexDirection: "column", marginLeft: "40px" }}>
            <div style={{ display: "flex", fontSize: "62px", color: OG_COLOR.text }}>
              @{ogTruncate(profile.username, HANDLE_MAX)}
            </div>
            {profile.bio ? (
              <div
                style={{
                  display: "flex",
                  marginTop: "14px",
                  fontSize: "26px",
                  color: OG_COLOR.muted,
                }}
              >
                {ogTruncate(profile.bio, BIO_MAX)}
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ display: "flex", gap: "72px" }}>
          <StatTile value={ogCount(profile.geolocations_count)} label="Geolocated" />
          <StatTile value={ogCount(profile.followers_count)} label="Followers" />
          {stats ? <StatTile value={ogCount(stats.media_count)} label="Media" /> : null}
        </div>
      </div>
    </OgCard>,
  );
}
