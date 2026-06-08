"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { MapPin, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  claimBounty,
  closeBounty,
  deleteBounty,
  getBounty,
  unclaimBounty,
} from "@/lib/bounties";
import { formatDate } from "@/lib/format";
import SourceLabel from "@/components/ui/SourceLabel";
import { displayUrlsFor } from "@/lib/mediaUrls";
import { renderProof } from "@/lib/proof";
import TrustBadge from "@/components/profile/TrustBadge";
import type { BountyDetail, BountyStatus } from "@/types";
import { PageCenter, PageShell } from "@/components/ui/PageShell";
import {
  PRIMARY_BUTTON,
  STATUS_PILL_ACTIVE,
  STATUS_PILL_CLOSED,
  STATUS_PILL_FULFILLED,
  TAG_CHIP,
} from "@/components/ui/styles";

export default function BountyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const [bounty, setBounty] = useState<BountyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);

  useEffect(() => {
    if (typeof params.id !== "string") return;
    getBounty(params.id)
      .then(setBounty)
      .catch((err: Error) => setError(err.message));
  }, [params.id]);

  if (error) {
    return (
      <PageCenter>
        <span className="text-red-400">{error}</span>
      </PageCenter>
    );
  }
  if (!bounty) {
    return (
      <PageCenter>
        <span className="text-neutral-500">Loading...</span>
      </PageCenter>
    );
  }

  const isAuthor = user?.id === bounty.author.id;
  const isClaimedByMe = !!user && bounty.claimers.some((c) => c.id === user.id);
  const canGeolocate = bounty.status === "open";

  const refresh = async () => {
    const fresh = await getBounty(bounty.id);
    setBounty(fresh);
  };

  const handleToggleClaim = async () => {
    setActionPending(true);
    setError(null);
    try {
      if (isClaimedByMe) {
        await unclaimBounty(bounty.id);
      } else {
        await claimBounty(bounty.id);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionPending(false);
    }
  };

  const handleClose = async () => {
    if (!confirm("Close this bounty? Other analysts will no longer be able to geolocate it.")) {
      return;
    }
    setActionPending(true);
    setError(null);
    try {
      const updated = await closeBounty(bounty.id);
      setBounty(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Close failed");
    } finally {
      setActionPending(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this bounty? This cannot be undone.")) return;
    setActionPending(true);
    setError(null);
    try {
      await deleteBounty(bounty.id);
      router.push("/bounties");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setActionPending(false);
    }
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
            className="text-orange-400 hover:underline transition-colors"
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
          <h2 className="text-xs text-neutral-500 uppercase tracking-wider mb-3">
            Media
          </h2>
          {bounty.media.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {bounty.media.map((m) => (
                <div
                  key={m.id}
                  className="rounded-lg overflow-hidden border border-neutral-700 bg-neutral-900"
                >
                  {m.media_type === "image" ? (
                    // 2-up grid inside max-w-4xl ≈ 384 CSS px wide.
                    // Same fit as the geolocation detail gallery —
                    // ``hero`` renders sharply at 2x DPI without the
                    // original's full payload.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={displayUrlsFor(m).hero}
                      alt={bounty.title}
                      className="w-full h-48 object-cover"
                    />
                  ) : (
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
          <h2 className="text-xs text-neutral-500 uppercase tracking-wider mb-3">
            Details
          </h2>
          <div className="bg-neutral-900 rounded-lg border border-neutral-700 divide-y divide-neutral-800">
            <div className="flex justify-between items-center px-4 py-3">
              <span className="text-sm text-neutral-500">Status</span>
              <StatusBadge status={bounty.status} />
            </div>
            <div className="flex justify-between px-4 py-3">
              <span className="text-sm text-neutral-500">Source</span>
              <SourceLabel
                isDemo={bounty.is_demo}
                url={bounty.source_url}
                variant="link"
                maxWidthClass="max-w-[300px]"
                className="text-sm ml-4"
              />
            </div>
            <div className="flex justify-between px-4 py-3">
              <span className="text-sm text-neutral-500">Posted</span>
              <span className="text-sm text-neutral-200">
                {formatDate(bounty.created_at)}
              </span>
            </div>
            {bounty.tags.length > 0 && (
              <div className="flex justify-between items-start px-4 py-3">
                <span className="text-sm text-neutral-500">Tags</span>
                <div className="flex flex-wrap gap-1.5 justify-end">
                  {bounty.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className={`text-xs px-2.5 py-0.5 rounded-full ${TAG_CHIP}`}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {bounty.status === "open" && (
              <div className="flex justify-between items-start px-4 py-3">
                <span className="text-sm text-neutral-500">Working on</span>
                {bounty.claimers.length > 0 ? (
                  <div className="flex flex-wrap gap-x-2 gap-y-1 justify-end max-w-[400px]">
                    {bounty.claimers.map((c) => (
                      <Link
                        key={c.id}
                        href={`/profile/${c.username}`}
                        className="text-sm text-orange-400 hover:underline transition-colors"
                      >
                        @{c.username}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <span className="text-sm text-neutral-600">—</span>
                )}
              </div>
            )}
            {bounty.fulfilled_by && (
              <div className="flex justify-between px-4 py-3">
                <span className="text-sm text-neutral-500">Fulfilled by</span>
                <Link
                  href={`/geolocations/${bounty.fulfilled_by.id}`}
                  className="text-sm text-orange-400 hover:underline transition-colors truncate ml-4 max-w-[300px]"
                >
                  {bounty.fulfilled_by.title}
                </Link>
              </div>
            )}
            {bounty.closed_at && (
              <div className="flex justify-between px-4 py-3">
                <span className="text-sm text-neutral-500">
                  {bounty.status === "fulfilled" ? "Fulfilled" : "Closed"}
                </span>
                <span className="text-sm text-neutral-200">
                  {formatDate(bounty.closed_at)}
                </span>
              </div>
            )}
          </div>
        </div>

        {bounty.description && (
          <div>
            <h2 className="text-xs text-neutral-500 uppercase tracking-wider mb-3">
              Description
            </h2>
            <div className="bg-neutral-900 rounded-lg p-4 border border-neutral-700">
              <div className="text-sm text-neutral-300 leading-relaxed">
                {renderProof(bounty.description)}
              </div>
            </div>
          </div>
        )}

        {/* Primary actions row — Submit-form-style: at the bottom after the
            user has read the bounty. Geolocate this is the page's purpose;
            "I'm working on this" is a quieter interest toggle and uses a
            neutral treatment so it doesn't compete with the primary CTA. */}
        {canGeolocate && (
          <div className="pt-4 border-t border-neutral-800 flex items-center gap-3 flex-wrap">
            <Link
              href={`/geolocations/new?bounty_id=${bounty.id}`}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md ${PRIMARY_BUTTON}`}
            >
              <MapPin size={14} />
              Geolocate this
            </Link>
            {!isAuthor && (
              <button
                type="button"
                onClick={handleToggleClaim}
                disabled={actionPending}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border transition-colors disabled:opacity-50 ${
                  isClaimedByMe
                    ? "bg-neutral-800 border-neutral-600 text-neutral-200 hover:bg-neutral-700"
                    : "bg-neutral-900 border-neutral-700 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                }`}
              >
                <Users size={14} />
                {isClaimedByMe ? "Stop signaling" : "I'm working on this"}
              </button>
            )}
          </div>
        )}

        {isAuthor && bounty.status === "open" && (
          <div className="pt-4 border-t border-neutral-800 flex items-center gap-4">
            <button
              type="button"
              onClick={handleClose}
              disabled={actionPending}
              className="text-sm text-neutral-400 hover:text-neutral-200 disabled:opacity-50 transition-colors"
            >
              Close this bounty
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={actionPending}
              className="text-sm text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
            >
              Delete this bounty
            </button>
          </div>
        )}
        {isAuthor && bounty.status === "closed" && (
          <div className="pt-4 border-t border-neutral-800">
            <button
              type="button"
              onClick={handleDelete}
              disabled={actionPending}
              className="text-sm text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
            >
              Delete this bounty
            </button>
          </div>
        )}
    </PageShell>
  );
}

function StatusBadge({ status }: { status: BountyStatus }) {
  const classes: Record<BountyStatus, string> = {
    open: STATUS_PILL_ACTIVE,
    fulfilled: STATUS_PILL_FULFILLED,
    closed: STATUS_PILL_CLOSED,
  };
  return (
    <span
      className={`shrink-0 px-1.5 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-semibold ${classes[status]}`}
    >
      {status}
    </span>
  );
}
