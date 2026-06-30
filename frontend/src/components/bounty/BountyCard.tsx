import type { ReactNode } from "react";
import Link from "next/link";
import { Clock, User, Users } from "lucide-react";

import type { BountyStatus, Media } from "@/types";
import { formatDate } from "@/lib/format";
import { TAPPABLE_HOVER } from "@/components/ui/styles";
import { MediaThumb } from "@/components/ui/MediaThumb";
import { TagBadge } from "@/components/ui/TagBadge";
import SourceLabel from "@/components/ui/SourceLabel";
import BountyStatusBadge from "@/components/bounty/BountyStatusBadge";

interface BountyCardProps {
  id: string;
  /** Plain text, or a highlighted node when rendered in search results. */
  title: ReactNode;
  authorUsername: string;
  sourceUrl: string;
  isDemo: boolean;
  status: BountyStatus;
  claimerCount: number;
  hero?: Media;
  /** Optional — present on the list (full) payload, absent on search hits. */
  createdAt?: string;
  tags?: { id: string; name: string }[];
  /** A few claimer handles for the "N working" tooltip, when available. */
  claimerSample?: { username: string }[];
}

// The single bounty card, used by the bounty list and search results. The two
// surfaces had diverged (status placement, source rendering); they're aligned
// here on one layout. The only real per-surface difference — search highlights
// the matched title — is the `title` node slot; `createdAt` / `tags` /
// `claimerSample` render when the payload carries them (search hits don't).
export function BountyCard({
  id,
  title,
  authorUsername,
  sourceUrl,
  isDemo,
  status,
  claimerCount,
  hero,
  createdAt,
  tags,
  claimerSample,
}: BountyCardProps) {
  const workingTitle =
    claimerSample && claimerSample.length > 0
      ? `Working on this: ${claimerSample
          .map((u) => `@${u.username}`)
          .join(", ")}${
          claimerCount > claimerSample.length
            ? ` (+${claimerCount - claimerSample.length} more)`
            : ""
        }`
      : undefined;

  return (
    <Link
      href={`/bounties/${id}`}
      className={`flex gap-3 p-3 bg-neutral-900 border border-neutral-800 rounded-md ${TAPPABLE_HOVER}`}
    >
      <MediaThumb media={hero} />
      {/* Status + "N working" sit beside the whole text column, not in the
          title row: a short title there would leave a gap before the meta. */}
      <div className="flex-1 min-w-0 flex items-start gap-2">
        <div className="flex-1 min-w-0 space-y-1.5">
          <h3 className="text-sm font-medium text-neutral-100 line-clamp-2">
            {title}
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
            <span className="inline-flex items-center gap-1">
              <User size={11} />@{authorUsername}
            </span>
            {createdAt && (
              <span className="inline-flex items-center gap-1">
                <Clock size={11} />
                {formatDate(createdAt)}
              </span>
            )}
            <SourceLabel isDemo={isDemo} url={sourceUrl} variant="inline" />
          </div>
          {tags && tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {tags.map((t) => (
                <TagBadge key={t.id} name={t.name} />
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <BountyStatusBadge status={status} />
          {claimerCount > 0 && (
            <span
              className="inline-flex items-center gap-1 text-[10px] text-neutral-400"
              title={workingTitle}
            >
              <Users size={10} />
              {claimerCount} working
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
