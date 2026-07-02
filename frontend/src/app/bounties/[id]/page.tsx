"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { MapPin, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import {
  claimBounty,
  closeBounty,
  deleteBounty,
  unclaimBounty,
} from "@/lib/bounties";
import { formatDate, formatEventDate, formatInstant } from "@/lib/format";
import { SourceLabel } from "@/components/ui/SourceLabel";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { ProofSection } from "@/components/ui/ProofSection";
import { displayUrlsFor } from "@/lib/mediaUrls";
import { renderProof } from "@/lib/proof";
import type { Concept } from "@/lib/fieldHelp";
import TrustBadge from "@/components/profile/TrustBadge";
import { BountyStatusBadge } from "@/components/bounty/BountyStatusBadge";
import type { BountyDetail } from "@/types";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { TEXT_LINK } from "@/components/ui/styles";
import { Button, buttonClasses } from "@/components/ui/Button";
import { DetailCard, DetailRow } from "@/components/ui/DetailRow";
import { Pill } from "@/components/ui/Pill";

export default function BountyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const {
    data: bounty,
    error: loadError,
    refetch,
  } = useApiResource<BountyDetail>(
    typeof params.id === "string" ? `/bounties/${params.id}` : null
  );
  // The three author/claim actions share one error + one pending flag, so each
  // mutation clears the others (mirrors the old single `setActionError(null)`).
  const toggleClaimMutation = useMutation(
    () => (isClaimedByMe ? unclaimBounty(bounty!.id) : claimBounty(bounty!.id)),
    { fallback: "Action failed", onSuccess: () => refetch() }
  );
  const closeMutation = useMutation(() => closeBounty(bounty!.id), {
    fallback: "Close failed",
    onSuccess: () => refetch(),
  });
  // `deleted` stays true through the post-delete navigation so the actions
  // don't re-enable in the unmount window (the row is gone; a second click
  // would 404). The old handler left its pending flag set instead of a finally.
  const [deleted, setDeleted] = useState(false);
  const deleteMutation = useMutation(() => deleteBounty(bounty!.id), {
    fallback: "Delete failed",
    onSuccess: () => {
      setDeleted(true);
      router.push("/bounties");
    },
  });

  const actionPending =
    toggleClaimMutation.loading ||
    closeMutation.loading ||
    deleteMutation.loading ||
    deleted;
  const actionError =
    toggleClaimMutation.error ?? closeMutation.error ?? deleteMutation.error;

  const error = loadError ?? actionError;

  if (error) {
    return (
      <PageError message={error} />
    );
  }
  if (!bounty) {
    return <PageLoading />;
  }

  const isAuthor = user?.id === bounty.author.id;
  const isClaimedByMe = !!user && bounty.claimers.some((c) => c.id === user.id);
  const canGeolocate = bounty.status === "open";

  // Curated tags get their own labelled rows (like a geolocation's detail) so
  // conflict / capture source read as structured facts, not free-form chips.
  const conflictTags = bounty.tags.filter((t) => t.category === "conflict");
  const captureTags = bounty.tags.filter((t) => t.category === "capture_source");
  const freeTags = bounty.tags.filter((t) => t.category === "free");
  const tagRow = (name: string, tags: BountyDetail["tags"], concept?: Concept) =>
    tags.length > 0 ? (
      <DetailRow label={name} concept={concept} align="start">
        <div className="flex flex-wrap gap-1.5 justify-end">
          {tags.map((tag) => (
            <Pill key={tag.id} tone="neutral">
              {tag.name}
            </Pill>
          ))}
        </div>
      </DetailRow>
    ) : null;

  const handleToggleClaim = async () => {
    closeMutation.reset();
    deleteMutation.reset();
    await toggleClaimMutation.run();
  };

  const handleClose = async () => {
    if (!confirm("Close this bounty? Other analysts will no longer be able to geolocate it.")) {
      return;
    }
    toggleClaimMutation.reset();
    deleteMutation.reset();
    await closeMutation.run();
  };

  const handleDelete = async () => {
    if (!confirm("Delete this bounty? This cannot be undone.")) return;
    toggleClaimMutation.reset();
    closeMutation.reset();
    await deleteMutation.run();
  };

  return (
    <PageShell
      back
      title={bounty.title}
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          by{" "}
          <Link
            href={`/profile/${bounty.author.username}`}
            className={`${TEXT_LINK} transition-colors`}
          >
            {bounty.author.username}
          </Link>
          <TrustBadge
            isTrusted={bounty.author.is_trusted}
            trustReason={bounty.author.trust_reason}
            size={14}
          />
        </span>
      }
    >
        <div>
          <SectionEyebrow title="Media" concept="source_media" />
          {bounty.media.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {bounty.media.map((m) => (
                <div
                  key={m.id}
                  className="rounded-lg overflow-hidden border border-neutral-700 bg-neutral-900"
                >
                  {m.media_type === "image" ? (
                    // 2-up grid ≈ 384 CSS px wide; `hero` renders sharply
                    // at 2x DPI without the original's full payload.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={displayUrlsFor(m).hero}
                      alt={bounty.title}
                      className="w-full h-48 object-cover"
                    />
                  ) : (
                    // `#t=0.1` media-fragment URI seeks to t=0.1s on
                    // metadata load; with `preload="metadata"` this paints
                    // the first frame as a poster, so the tile isn't a
                    // black box before play — no per-bounty poster needed.
                    <video
                      src={`${m.storage_url}#t=0.1`}
                      controls
                      preload="metadata"
                      className="w-full h-48 object-cover"
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-neutral-700 bg-neutral-800 h-48 flex items-center justify-center">
              <span className="text-sm text-neutral-500">No media</span>
            </div>
          )}
        </div>

        <div>
          <SectionEyebrow title="Details" />
          <DetailCard>
            <DetailRow label="Status" concept="bounty_status" align="center">
              <BountyStatusBadge status={bounty.status} />
            </DetailRow>
            {/* The dates read as one block — event → source → posted. */}
            {bounty.event_date && (
              <DetailRow
                label="Event date"
                concept="event_date"
                value={formatEventDate(bounty.event_date, bounty.event_time)}
              />
            )}
            <DetailRow
              label="Source posted"
              concept="source_posted_at"
              value={formatInstant(bounty.source_posted_at)}
            />
            <DetailRow
              label="Added"
              concept="added"
              value={formatDate(bounty.created_at)}
            />
            <DetailRow label="Source" concept="source_url">
              <SourceLabel
                isDemo={bounty.is_demo}
                url={bounty.source_url}
                variant="link"
                maxWidthClass="max-w-[300px]"
                className="text-sm ml-4"
              />
            </DetailRow>
            {tagRow("Conflict", conflictTags, "conflict")}
            {tagRow("Capture source", captureTags, "capture_source")}
            {tagRow("Tags", freeTags)}
            {bounty.status === "open" && (
              <DetailRow label="Working on" align="start">
                {bounty.claimers.length > 0 ? (
                  <div className="flex flex-wrap gap-x-2 gap-y-1 justify-end max-w-[400px]">
                    {bounty.claimers.map((c) => (
                      <Link
                        key={c.id}
                        href={`/profile/${c.username}`}
                        className={`text-sm ${TEXT_LINK} transition-colors`}
                      >
                        @{c.username}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <span className="text-sm text-neutral-600">—</span>
                )}
              </DetailRow>
            )}
            {bounty.fulfilled_by && (
              <DetailRow label="Fulfilled by">
                <Link
                  href={`/geolocations/${bounty.fulfilled_by.id}`}
                  className={`text-sm ${TEXT_LINK} transition-colors truncate ml-4 max-w-[300px]`}
                >
                  {bounty.fulfilled_by.title}
                </Link>
              </DetailRow>
            )}
            {bounty.closed_at && (
              <DetailRow
                label={bounty.status === "fulfilled" ? "Fulfilled" : "Closed"}
                value={formatDate(bounty.closed_at)}
              />
            )}
          </DetailCard>
        </div>

        {bounty.proof && (
          <ProofSection>
            <div className="text-sm text-neutral-300 leading-relaxed">
              {renderProof(bounty.proof)}
            </div>
          </ProofSection>
        )}

        {/* Actions at the bottom, after the user has read the bounty.
            "I'm working on this" gets a neutral treatment so it doesn't
            compete with the "Geolocate this" CTA. */}
        {canGeolocate && (
          <div className="pt-4 border-t border-neutral-800 flex items-center gap-3 flex-wrap">
            <Link
              href={`/submit?bounty_id=${bounty.id}`}
              className={buttonClasses("primary")}
            >
              <MapPin size={14} />
              Geolocate this
            </Link>
            {!isAuthor && (
              <Button
                variant="secondary"
                onClick={handleToggleClaim}
                disabled={actionPending}
              >
                <Users size={14} />
                {isClaimedByMe ? "Stop signaling" : "I'm working on this"}
              </Button>
            )}
          </div>
        )}

        {isAuthor && bounty.status === "open" && (
          <div className="pt-4 border-t border-neutral-800 flex items-center gap-4">
            <Button variant="ghost" onClick={handleClose} disabled={actionPending}>
              Close this bounty
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={actionPending}>
              Delete this bounty
            </Button>
          </div>
        )}
        {isAuthor && bounty.status === "closed" && (
          <div className="pt-4 border-t border-neutral-800">
            <Button variant="danger" onClick={handleDelete} disabled={actionPending}>
              Delete this bounty
            </Button>
          </div>
        )}
    </PageShell>
  );
}
