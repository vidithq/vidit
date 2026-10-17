import { ogTruncate } from "@/lib/og";

import { OG_COLOR, OgBadge, OgCard } from "./card";

// The share card of a public profile: an analyst's (`/profile/{username}`) or an
// organization's (`/organizations/{slug}`). Avatar, name and bio over a row of
// stat tiles, inside the shared frame.

/** Enough of a bio to place the profile, cut before it can wrap past two lines. */
const BIO_MAX = 120;

/** Name width the header can hold at its type size beside the avatar. */
const NAME_MAX = 20;

const AVATAR_PX = 160;

export interface PortfolioStat {
  value: string;
  label: string;
}

function StatTile({ value, label }: PortfolioStat) {
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

function Avatar({ src, name }: { src: string | null; name: string }) {
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
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={AVATAR_PX} height={AVATAR_PX} style={{ ...shared, objectFit: "cover" }} />;
  }
  // Monogram fallback, as in `<Avatar>`: the name's first character.
  return (
    <div style={{ ...shared, alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", fontSize: "72px", color: OG_COLOR.muted }}>
        {(name[0] ?? "?").toUpperCase()}
      </div>
    </div>
  );
}

export function PortfolioCard({
  badge,
  caption,
  avatar,
  name,
  bio,
  stats,
}: {
  /** The kind in the corner: `Analyst` or `Organization`. */
  badge: string;
  caption?: string;
  /** A data URI from `ogImageDataUri`, or null for the monogram. */
  avatar: string | null;
  name: string;
  bio: string | null;
  stats: PortfolioStat[];
}) {
  return (
    <OgCard badge={<OgBadge label={badge} />} caption={caption}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <Avatar src={avatar} name={name} />
          <div style={{ display: "flex", flexDirection: "column", marginLeft: "40px" }}>
            <div style={{ display: "flex", fontSize: "62px", color: OG_COLOR.text }}>
              {ogTruncate(name, NAME_MAX)}
            </div>
            {bio ? (
              <div
                style={{
                  display: "flex",
                  marginTop: "14px",
                  fontSize: "26px",
                  color: OG_COLOR.muted,
                }}
              >
                {ogTruncate(bio, BIO_MAX)}
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ display: "flex", gap: "72px" }}>
          {stats.map((stat) => (
            <StatTile key={stat.label} {...stat} />
          ))}
        </div>
      </div>
    </OgCard>
  );
}
