"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { apiFetch } from "@/lib/api";
import { getBounty } from "@/lib/bounties";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import type { BountyDetail, Tag } from "@/types";
import { PageCenter, PageShell } from "@/components/ui/PageShell";
import { TweetImportBanner } from "@/components/geolocation/TweetImportBanner";
import { TagPicker } from "@/components/ui/TagPicker";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import { DuplicateProbe } from "@/components/geolocations/new/DuplicateProbe";
import { EvidenceUploader } from "@/components/geolocations/new/EvidenceUploader";
import { LocationPicker } from "@/components/geolocations/new/LocationPicker";
import { ProofEditorPanel } from "@/components/geolocations/new/ProofEditorPanel";
import { useTweetImport } from "@/components/geolocations/new/useTweetImport";

export default function NewGeolocationPage() {
  // `useSearchParams` opts out of static prerender; Next 14 requires the
  // bailing component under a Suspense boundary. Fallback is minimal — the
  // inner form shows its own "Loading…" once auth resolves.
  return (
    <Suspense
      fallback={
        <PageCenter>
          <span className="text-neutral-500">Loading...</span>
        </PageCenter>
      }
    >
      <NewGeolocationForm />
    </Suspense>
  );
}

function NewGeolocationForm() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const bountyIdParam = searchParams.get("bounty_id");

  const [bounty, setBounty] = useState<BountyDetail | null>(null);
  const [bountyError, setBountyError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [proof, setProof] = useState<Record<string, unknown> | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  // useState, not useApiResource: TagPicker appends newly created tags
  // via setTags, so the list is server-seeded but locally mutable.
  const [tags, setTags] = useState<Tag[]>([]);
  // Required curated selectors (conflict + capture source). `?curated=true`
  // includes the full taxonomy even for options no live geolocation
  // references yet, else the first analyst to use one couldn't pick it and
  // the required field would be unsatisfiable. A failed load (empty
  // `curatedTags`) surfaces a recoverable `curatedTagsError` rather than a
  // misleading "Select a conflict" with no chips.
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
            `This bounty is ${b.status} — can't be fulfilled. Open the bounty page instead.`
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

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
    // Mirrors the server check in
    // `routers/geolocations.py::create_geolocation`, inline so the analyst
    // sees it before upload instead of as a 400. Empty taxonomy (failed
    // load) gets a recoverable message, distinct from "didn't pick one".
    if (curatedTags.length === 0) {
      setError(
        curatedTagsError
          ? "Couldn’t load the required Conflict and Capture source options — use Retry above, or reload the page."
          : "Still loading the required tag options — give it a moment and try again."
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
        <div className={FORM_ERROR_BANNER}>
          {bountyError}
        </div>
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

  return (
    <PageShell
      title={lockedFromBounty ? "Geolocate a bounty" : "Submit"}
      subtitle={
        lockedFromBounty ? (
          <>
            You&apos;re fulfilling a bounty posted by{" "}
            <Link
              href={`/profile/${bounty!.author.username}`}
              className="text-orange-400 hover:underline"
            >
              @{bounty!.author.username}
            </Link>
            . Title and tags are pre-filled from the bounty — refine them
            if needed. Source and media stay locked (that&apos;s the
            bounty&apos;s evidence). Add coordinates, an event date, and
            the proof body (cross-referenced satellite imagery). When you
            submit, the bounty is archived as fulfilled and the resulting
            geolocation traces back to it.
          </>
        ) : (
          "Cross-reference source media against satellite imagery and annotate matching anchor points so other analysts can audit the call."
        )
      }
    >
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Hidden in bounty-fulfilment mode: source URL + media are
              locked there, so the import pre-fill has nowhere to land. */}
          {!lockedFromBounty && (
            <TweetImportBanner
              onImported={applyTweetImport}
              onClear={clearImportedTweet}
              importedFrom={importedFrom}
              linkedX={user?.external_links?.x ?? null}
            />
          )}

          <LocationPicker
            title={title}
            setTitle={setTitle}
            lat={lat}
            setLat={setLat}
            lng={lng}
            setLng={setLng}
            sourceUrl={sourceUrl}
            setSourceUrl={setSourceUrl}
            eventDate={eventDate}
            setEventDate={setEventDate}
            lockedFromBounty={lockedFromBounty}
            extraCoordCandidates={extraCoordCandidates}
            onSwapCandidate={swapCoordCandidate}
          />

          <EvidenceUploader
            lockedMedia={bounty ? bounty.media : null}
            files={files}
            setFiles={setFiles}
          />

          {curatedTagsError && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              <span>
                Couldn&apos;t load the required Conflict and Capture source
                options.
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
            requireConflict
            requireCaptureSource
            subtitle={
              lockedFromBounty
                ? "Pre-filled from the bounty — adjust as needed. Conflict and capture source are required."
                : "Conflict and capture source are required; add any free-form tags that apply."
            }
          />

          <ProofEditorPanel
            importedFrom={importedFrom}
            importGen={importGen}
            proof={proof}
            onChange={setProof}
            onUploadStateChange={setProofImageUploading}
          />

          <DuplicateProbe
            lat={lat}
            lng={lng}
            sourceUrl={sourceUrl}
            eventDate={eventDate}
            skip={lockedFromBounty}
          />

          {/* Errors render next to the button, not atop this long form, so
              a failed submit is visible without scrolling up. Every `error`
              here is set by handleSubmit, so the button is the right anchor. */}
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
              {submitting
                ? "Submitting…"
                : proofImageUploading
                  ? "Image uploading…"
                  : lockedFromBounty
                    ? "Submit geolocation (archive bounty)"
                    : "Submit geolocation"}
            </button>
            <Link
              href={lockedFromBounty ? `/bounties/${bounty!.id}` : "/"}
              className="text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>
    </PageShell>
  );
}
