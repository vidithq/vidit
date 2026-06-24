"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { apiFetch } from "@/lib/api";
import { createBounty, getBounty } from "@/lib/bounties";
import { FORM_ERROR_BANNER, FORM_INPUT, FORM_LABEL } from "@/components/ui/form-styles";
import type { BountyDetail, Tag } from "@/types";
import { PageCenter, PageShell } from "@/components/ui/PageShell";
import { Modal } from "@/components/ui/Modal";
import { TweetImportBanner } from "@/components/geolocation/TweetImportBanner";
import { TagPicker } from "@/components/ui/TagPicker";
import FieldHelp from "@/components/ui/FieldHelp";
import { FIELD_HELP } from "@/lib/fieldHelp";
import { FILTER_CHIP_ACTIVE, PRIMARY_BUTTON } from "@/components/ui/styles";
import { DetailsFields } from "@/components/geolocations/new/DetailsFields";
import { DuplicateProbe } from "@/components/geolocations/new/DuplicateProbe";
import { LocationPicker } from "@/components/geolocations/new/LocationPicker";
import { ProofEditorPanel } from "@/components/geolocations/new/ProofEditorPanel";
import { useTweetImport } from "@/components/geolocations/new/useTweetImport";

type SubmitType = "geolocation" | "bounty";

// Inline X logo — lucide ships none, and "Import from a tweet" reads clearer
// with the source platform's mark than a generic import glyph.
function XGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export default function SubmitPage() {
  // `useSearchParams` opts out of static prerender; Next requires the bailing
  // component under a Suspense boundary. Fallback is minimal — the inner form
  // shows its own "Loading…" once auth resolves.
  return (
    <Suspense
      fallback={
        <PageCenter>
          <span className="text-neutral-500">Loading...</span>
        </PageCenter>
      }
    >
      <SubmitForm />
    </Suspense>
  );
}

function SubmitForm() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const bountyIdParam = searchParams.get("bounty_id");

  const [bounty, setBounty] = useState<BountyDetail | null>(null);
  const [bountyError, setBountyError] = useState<string | null>(null);

  // One page, two submission types. Fulfilling a bounty (``?bounty_id=``) is
  // always a geolocation, so the toggle is hidden there; ``?type=bounty`` (the
  // "Post bounty" entry) seeds bounty mode.
  const [submitType, setSubmitType] = useState<SubmitType>(
    !bountyIdParam && searchParams.get("type") === "bounty" ? "bounty" : "geolocation"
  );
  const isBounty = submitType === "bounty";

  const [importOpen, setImportOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [eventDate, setEventDate] = useState("");
  // Optional: the date the source posted the media. Independent of the tweet
  // import (a source is often a Telegram link, not the imported tweet).
  const [sourceDate, setSourceDate] = useState("");
  const [proof, setProof] = useState<Record<string, unknown> | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  // useState, not useApiResource: TagPicker appends newly created tags
  // via setTags, so the list is server-seeded but locally mutable.
  const [tags, setTags] = useState<Tag[]>([]);
  // Required curated selectors (conflict + capture source) for geolocations.
  // `?curated=true` includes the full taxonomy even for options no live
  // geolocation references yet, else the first analyst to use one couldn't pick
  // it and the required field would be unsatisfiable. A failed load (empty
  // `curatedTags`) surfaces a recoverable `curatedTagsError`.
  const {
    data: curatedTagsData,
    error: curatedTagsError,
    refetch: reloadCuratedTags,
  } = useApiResource<Tag[]>("/tags?curated=true");
  const curatedTags = curatedTagsData ?? [];
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [proofImageUploading, setProofImageUploading] = useState(false);

  const {
    importedFrom,
    importGen,
    extraCoordCandidates,
    applyTweetImport,
    clearImportedTweet,
    swapCoordCandidate,
  } = useTweetImport({
    lat,
    lng,
    setTitle,
    setLat,
    setLng,
    setSourceUrl,
    setEventDate,
    setFiles,
    setProof,
  });

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    apiFetch<Tag[]>("/tags")
      .then(setTags)
      .catch(() => {});
  }, []);

  // Load the bounty being fulfilled to pre-fill + lock inherited fields.
  // The server is authoritative (ignores divergent values when bounty_id
  // is present); locking is just the UX cue.
  useEffect(() => {
    if (!bountyIdParam) return;
    getBounty(bountyIdParam)
      .then((b) => {
        if (b.status !== "open") {
          setBountyError(
            `This bounty is ${b.status}, so it can't be fulfilled. Open the bounty page instead.`
          );
          return;
        }
        setBounty(b);
        setTitle(b.title);
        setSourceUrl(b.source_url);
        setSelectedTagIds(b.tags.map((t) => t.id));
      })
      .catch((err: Error) => setBountyError(err.message));
  }, [bountyIdParam]);

  const lockedFromBounty = bounty !== null;
  // Geolocation-only fields (coordinates, dates, proof) are hidden in bounty
  // mode — a bounty is an unfinished geolocation.
  const showGeoFields = !isBounty;
  // No type toggle while fulfilling a bounty: that path is always a geolocation.
  const showToggle = !bountyIdParam;

  const submitBounty = async () => {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!sourceUrl.trim()) {
      setError("Source URL is required");
      return;
    }
    if (files.length === 0) {
      setError("At least one media file is required");
      return;
    }
    setSubmitting(true);
    try {
      const created = await createBounty({
        title: title.trim(),
        source_url: sourceUrl.trim(),
        event_date: eventDate || undefined,
        source_date: sourceDate || undefined,
        tag_ids: selectedTagIds,
        files,
      });
      router.push(`/bounties/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  const submitGeolocation = async () => {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);

    if (isNaN(latNum) || latNum < -90 || latNum > 90) {
      setError("Latitude must be a number between -90 and 90");
      return;
    }
    if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
      setError("Longitude must be a number between -180 and 180");
      return;
    }
    // When fulfilling a bounty, its media transfers in, so no new files
    // are required; otherwise at least one file is required.
    if (!lockedFromBounty && files.length === 0) {
      setError("At least one media file is required");
      return;
    }
    if (!proof) {
      setError("Proof is required");
      return;
    }
    if (proofImageUploading) {
      setError("An image is still uploading — please wait before submitting.");
      return;
    }
    // Mirrors the server check in `routers/geolocations.py`, inline so the
    // analyst sees it before upload instead of as a 400. Empty taxonomy
    // (failed load) gets a recoverable message, distinct from "didn't pick one".
    if (curatedTags.length === 0) {
      setError(
        curatedTagsError
          ? "Couldn’t load the required Conflict and Capture source options. Use Retry above, or reload the page."
          : "Still loading the required tag options. Give it a moment and try again."
      );
      return;
    }
    const selectedSet = new Set(selectedTagIds);
    const hasConflict = curatedTags.some(
      (t) => t.category === "conflict" && selectedSet.has(t.id)
    );
    const hasCaptureSource = curatedTags.some(
      (t) => t.category === "capture_source" && selectedSet.has(t.id)
    );
    if (!hasConflict) {
      setError("Select a conflict (use “Other” if it isn’t listed).");
      return;
    }
    if (!hasCaptureSource) {
      setError("Select a capture source (use “Unknown” if unsure).");
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("title", title);
      formData.append("lat", latNum.toString());
      formData.append("lng", lngNum.toString());
      formData.append("source_url", sourceUrl);
      formData.append("event_date", eventDate);
      if (sourceDate) {
        formData.append("source_date", sourceDate);
      }
      formData.append("proof", JSON.stringify(proof));
      if (selectedTagIds.length > 0) {
        formData.append("tag_ids", JSON.stringify(selectedTagIds));
      }
      if (bounty) {
        formData.append("bounty_id", bounty.id);
      }
      for (const file of files) {
        formData.append("files", file);
      }

      const result = await apiFetch<{ id: string }>("/geolocations", {
        method: "POST",
        body: formData,
      });
      router.push(`/geolocations/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (isBounty) {
      await submitBounty();
    } else {
      await submitGeolocation();
    }
  };

  if (authLoading || !user) {
    return (
      <PageCenter>
        <span className="text-neutral-500">Loading...</span>
      </PageCenter>
    );
  }

  // Bounty referenced but couldn't load (404 / wrong status / network).
  if (bountyIdParam && bountyError) {
    return (
      <PageShell title="Geolocate a bounty">
        <div className={FORM_ERROR_BANNER}>{bountyError}</div>
        <Link href="/bounties" className="text-sm text-orange-400 hover:underline">
          ← Back to bounties
        </Link>
      </PageShell>
    );
  }

  // Bounty referenced but still loading — block the form until the
  // title / source / tags are known to pre-fill.
  if (bountyIdParam && !bounty) {
    return (
      <PageCenter>
        <span className="text-neutral-500">Loading bounty…</span>
      </PageCenter>
    );
  }

  // Header is uniform across both toggle states — the toggle below owns the
  // geolocation-vs-bounty framing. Fulfilment is a distinct entry (no toggle),
  // so it keeps its own title + instructions.
  const pageTitle = lockedFromBounty ? "Geolocate a bounty" : "Submit";
  const subtitle = lockedFromBounty ? (
    <>
      You&apos;re fulfilling a bounty posted by{" "}
      <Link
        href={`/profile/${bounty!.author.username}`}
        className="text-orange-400 hover:underline"
      >
        @{bounty!.author.username}
      </Link>
      . Title and tags are pre-filled from the bounty; refine them if needed.
      Source and media stay locked (that&apos;s the bounty&apos;s evidence). Add
      coordinates, an event date, and the proof body (cross-referenced satellite
      imagery). When you submit, the bounty is archived as fulfilled and the
      resulting geolocation traces back to it.
    </>
  ) : (
    "Add a geolocation, or post a bounty for footage you couldn't place yet."
  );

  return (
    <PageShell title={pageTitle} subtitle={subtitle}>
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Toggle on the left, the import shortcut mirrored on the right at the
            same height. Import is geolocation-only (a bounty has nothing to
            pre-fill); inside `showToggle`, so it never shows in fulfilment. */}
        {showToggle && (
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex h-9 items-center rounded-md border border-neutral-700 bg-neutral-900 p-0.5">
              {(["geolocation", "bounty"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setSubmitType(t)}
                  aria-pressed={submitType === t}
                  className={`px-3 py-1 text-sm rounded transition-colors ${
                    submitType === t
                      ? FILTER_CHIP_ACTIVE
                      : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  {t === "geolocation" ? "Geolocation" : "Bounty"}
                </button>
              ))}
            </div>
            {showGeoFields && (
              <button
                type="button"
                onClick={() => setImportOpen(true)}
                className="inline-flex h-9 items-center gap-2 px-3 rounded-md border border-orange-500/30 bg-orange-500/5 text-sm text-orange-400 hover:bg-orange-500/10 hover:border-orange-500/50 transition-colors"
              >
                <XGlyph size={13} />
                Import from a tweet
              </button>
            )}
          </div>
        )}

        <p className="text-xs text-neutral-500">
          All fields are required unless marked{" "}
          <span className="text-neutral-400">optional</span>.
        </p>

        {/* Title leads, mirroring the detail page where it's the heading. */}
        <div className="space-y-1.5">
          <label htmlFor="title" className={FORM_LABEL}>
            Title <FieldHelp text={FIELD_HELP.title} label="What makes a good title?" />
          </label>
          <input
            id="title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Strike on ammunition depot, Donetsk"
            className={FORM_INPUT}
          />
        </div>

        {/* One "Location" block in both modes: source media + coordinates for a
            geolocation, source media alone for a bounty (no point yet). */}
        <LocationPicker
          lockedMedia={bounty ? bounty.media : null}
          files={files}
          setFiles={setFiles}
          lat={lat}
          setLat={setLat}
          lng={lng}
          setLng={setLng}
          extraCoordCandidates={extraCoordCandidates}
          onSwapCandidate={swapCoordCandidate}
          showCoords={showGeoFields}
        />

        <DetailsFields
          sourceUrl={sourceUrl}
          setSourceUrl={setSourceUrl}
          eventDate={eventDate}
          setEventDate={setEventDate}
          sourceDate={sourceDate}
          setSourceDate={setSourceDate}
          lockedFromBounty={lockedFromBounty}
          eventDateRequired={showGeoFields}
        />

        {showGeoFields && curatedTagsError && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <span>
              Couldn&apos;t load the required Conflict and Capture source options.
            </span>
            <button
              type="button"
              onClick={reloadCuratedTags}
              className="shrink-0 font-medium text-orange-400 hover:underline"
            >
              Retry
            </button>
          </div>
        )}
        <TagPicker
          tags={tags}
          setTags={setTags}
          curatedTags={curatedTags}
          selectedTagIds={selectedTagIds}
          setSelectedTagIds={setSelectedTagIds}
          requireConflict={showGeoFields}
          requireCaptureSource={showGeoFields}
        />

        {showGeoFields && (
          <ProofEditorPanel
            importedFrom={importedFrom}
            importGen={importGen}
            proof={proof}
            onChange={setProof}
            onUploadStateChange={setProofImageUploading}
          />
        )}

        {showGeoFields && (
          <DuplicateProbe
            lat={lat}
            lng={lng}
            sourceUrl={sourceUrl}
            eventDate={eventDate}
            skip={lockedFromBounty}
          />
        )}

        {/* Errors render next to the button, not atop this long form, so a
            failed submit is visible without scrolling up. */}
        {error && (
          <div className={FORM_ERROR_BANNER} role="alert">
            {error}
          </div>
        )}

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={submitting || proofImageUploading}
            className={`px-4 py-2 disabled:opacity-50 rounded-md text-sm font-medium ${PRIMARY_BUTTON}`}
          >
            {isBounty
              ? submitting
                ? "Posting…"
                : "Post bounty"
              : submitting
                ? "Submitting…"
                : proofImageUploading
                  ? "Image uploading…"
                  : lockedFromBounty
                    ? "Submit geolocation (archive bounty)"
                    : "Submit geolocation"}
          </button>
          <Link
            href={isBounty ? "/bounties" : lockedFromBounty ? `/bounties/${bounty!.id}` : "/"}
            className="text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            Cancel
          </Link>
        </div>
      </form>

      {/* Import is a header action, not a field — a tweet pre-fills the form,
          reviewed before submit. Modal keeps it out of the field flow. */}
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import from a tweet"
        subtitle={FIELD_HELP.section_import}
      >
        <TweetImportBanner
          onImported={applyTweetImport}
          onClear={clearImportedTweet}
          importedFrom={importedFrom}
          linkedX={user?.external_links?.x ?? null}
        />
      </Modal>
    </PageShell>
  );
}
