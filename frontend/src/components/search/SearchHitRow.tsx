import { Fragment, type ReactNode } from "react";
import { Building2, MapPin, Megaphone, Users, type LucideIcon } from "lucide-react";

import { CollectionCover } from "@/components/collections/CollectionCover";
import { EVENT_STATUS_META } from "@/components/event/StatusBadge";
import { Avatar } from "@/components/ui/Avatar";
import { ACTION_ICONS } from "@/components/ui/Button";
import { MediaThumb } from "@/components/ui/EntityCard";
import { LinkRow } from "@/components/ui/LinkRow";
import { CollectionIcon, collectionHref, collectionMetaSegments } from "@/lib/collections";
import { formatDate } from "@/lib/format";
import { memberCountLabel, organizationPath } from "@/lib/organizations";
import { eventHref, profileHref, requestHref } from "@/lib/routes";
import { splitHighlights } from "@/lib/search";
import { SITE_KIND_LABELS, siteHref } from "@/lib/sites";
import type { Media, SearchHit } from "@/types";

/**
 * Render a sentinel-wrapped highlight string as text and `<mark>`; `splitHighlights`' even/odd
 * parity is safe since the backend emits well-formed pairs.
 */
export function Highlighted({ value }: { value: string }) {
  return (
    <>
      {splitHighlights(value).map((seg, i) =>
        seg.highlighted ? (
          <mark key={i} className="bg-orange-500/30 text-inherit rounded-sm px-0.5">
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

/** The detail line: the kind first, then the date and the analyst, joined by middots. */
function Detail({ parts }: { parts: ReactNode[] }) {
  const shown = parts.filter((part) => part !== null && part !== undefined && part !== "");
  return (
    <span>
      {shown.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && " · "}
          {part}
        </Fragment>
      ))}
    </span>
  );
}

/** A picture leads the row only when it is not graphic: the gate's reveal control cannot sit
 *  inside the row's link. */
function thumb(media: Media | undefined, isGraphic = false): ReactNode {
  return media && !isGraphic ? <MediaThumb media={media} className="w-16" /> : undefined;
}

function Row({
  icon,
  leading,
  value,
  detail,
  href,
}: {
  icon: LucideIcon;
  leading?: ReactNode;
  value: ReactNode;
  detail: ReactNode[];
  href: string;
}) {
  return (
    <LinkRow
      icon={icon}
      leading={leading}
      value={value}
      meta={<Detail parts={detail} />}
      href={href}
      external={false}
      variant="arrow"
    />
  );
}

/** One hit of the search page's list: the arrow `LinkRow`, its picture or its kind's icon, the
 *  highlighted name, and a detail line that names the kind first. */
export function SearchHitRow({ hit }: { hit: SearchHit }) {
  switch (hit.type) {
    case "event": {
      const requested = hit.status === "requested";
      return (
        <Row
          icon={requested ? Megaphone : MapPin}
          leading={thumb(hit.media[0], hit.is_graphic)}
          value={<Highlighted value={hit.title_highlight} />}
          detail={[
            EVENT_STATUS_META[hit.status].label,
            hit.occurred_date && formatDate(hit.occurred_date),
            hit.owner.username,
          ]}
          href={requested ? requestHref(hit.id) : eventHref(hit.id)}
        />
      );
    }
    case "site":
      return (
        <Row
          icon={ACTION_ICONS.site}
          leading={thumb(hit.media[0])}
          value={<Highlighted value={hit.name_highlight} />}
          detail={[
            "Site",
            SITE_KIND_LABELS[hit.kind],
            hit.last_source && formatDate(hit.last_source.captured_at),
            hit.owner.username,
          ]}
          href={siteHref(hit.id)}
        />
      );
    case "collection":
      return (
        <Row
          icon={CollectionIcon}
          leading={
            hit.cover.length > 0 ? (
              <CollectionCover cover={hit.cover} className="w-16 shrink-0" />
            ) : undefined
          }
          value={hit.title}
          detail={["Collection", ...collectionMetaSegments(hit), hit.owner.username]}
          href={collectionHref(hit.id)}
        />
      );
    case "user":
      return (
        <Row
          icon={Users}
          leading={<Avatar src={hit.avatar_url} username={hit.username} size="size-7" />}
          value={<Highlighted value={hit.username_highlight} />}
          detail={["Analyst", hit.bio_highlight && <Highlighted value={hit.bio_highlight} />]}
          href={profileHref(hit.username)}
        />
      );
    case "organization":
      return (
        <Row
          icon={Building2}
          leading={
            <Avatar src={hit.avatar_url} username={hit.name} size="size-7" shape="square" />
          }
          value={<Highlighted value={hit.name_highlight} />}
          detail={[
            "Organization",
            memberCountLabel(hit.member_count),
            hit.bio_highlight && <Highlighted value={hit.bio_highlight} />,
          ]}
          href={organizationPath(hit.slug)}
        />
      );
  }
}
