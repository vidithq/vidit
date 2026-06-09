"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { AlertTriangle, Lock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { apiFetch } from "@/lib/api";
import { getBounty } from "@/lib/bounties";
import { displayUrlsFor } from "@/lib/mediaUrls";
import { formatDate } from "@/lib/format";
import {
  FORM_ERROR_BANNER,
  FORM_INPUT,
  FORM_INPUT_LOCKED,
  FORM_LABEL,
} from "@/components/ui/form-styles";
import type {
  BountyDetail,
  PossibleDuplicate,
  Tag,
  TweetImportMedia,
  TweetImportResponse,
} from "@/types";
import { PageCenter, PageShell } from "@/components/ui/PageShell";
import { TweetImportBanner } from "@/components/geolocation/TweetImportBanner";
import { FilePreviewGrid } from "@/components/ui/FilePreviewGrid";
import { TagPicker } from "@/components/ui/TagPicker";
import { PRIMARY_BUTTON } from "@/components/ui/styles";

// Coords + source-url + event-date go through this debounce before we
// fire the duplicate probe so we don't slam the endpoint per keystroke.
// 500ms is the standard "user paused typing" threshold — short enough
// that the warning lands while the analyst is still on the form, long
// enough that we're not chasing every digit of a longitude.
const DUPLICATE_PROBE_DEBOUNCE_MS = 500;

const ProofEditor = dynamic(
  () => import("@/components/editor/ProofEditor"),
  { ssr: false }
);


export default function NewGeolocationPage() {
  // ``useSearchParams`` opts the page out of static prerender; Next.js
  // 14 requires the bailing component to live under a Suspense boundary
  // so the static-export pass has something to render while the client
  // hydrates. The fallback is intentionally minimal — the inner form
  // shows its own "Loading…" state once auth resolves.
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
  // Live tags stay useState (not useApiResource): TagPicker appends
  // newly created tags via setTags, so the list is server-seeded but
  // locally mutable.
  const [tags, setTags] = useState<Tag[]>([]);
  // The two required, server-curated selectors (conflict + capture
  // source). Fetched with `?curated=true` so the full taxonomy is
  // present even for options no live geolocation references yet —
  // otherwise the first analyst to use a given conflict / capture source
  // couldn't pick it and the required field would be unsatisfiable.
  // The selectors it feeds are required, so an empty `curatedTags` from
  // a failed load (vs. a genuine "didn't pick one") surfaces a
  // different, recoverable message via `curatedTagsError` instead of a
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
  // Soft warning: rows the duplicate probe surfaces as "maybe the
  // same event". Never blocks submission — the analyst skims and
  // decides. Cleared / re-fetched whenever the four signal fields
  // (coords, source URL, event date) change.
  const [possibleDuplicates, setPossibleDuplicates] = useState<
    PossibleDuplicate[]
  >([]);
  // Tweet-import banner state: handle of the most recent successful
  // import (drives the "Imported from @x — clear" confirmation slot)
  // and the extra coordinate candidates surfaced as swap chips when
  // the parser found more than one.
  const [importedFrom, setImportedFrom] = useState<string | null>(null);
  const [extraCoordCandidates, setExtraCoordCandidates] = useState<
    { lat: number; lng: number }[]
  >([]);
  // Monotonic counter incremented on every Import / Clear so a slow
  // import (downloading + uploading N media) can detect that the
  // analyst has moved on and stop trying to apply stale state. The
  // ``current`` value captured at the start of ``applyTweetImport``
  // is the local "import id"; if it diverges from ``importTokenRef``
  // by the time we'd write to React state, the import is cancelled.
  const importTokenRef = useRef(0);
  // Render-visible companion to ``importTokenRef``: refs don't trigger
  // re-renders, so a re-import of a tweet by the same author would
  // leave ``importedFrom`` and the ``ProofEditor`` ``key`` unchanged
  // — and the editor would silently keep its previous content. This
  // counter bumps in lockstep with ``importTokenRef`` and the editor
  // ``key`` reads it, forcing a clean re-mount on every successful
  // import even when the author handle is identical.
  const [importGen, setImportGen] = useState(0);
  // AbortController for in-flight fetches inside the current import.
  // ``Clear`` and re-Import both abort the previous controller, which
  // surfaces as ``AbortError`` on the in-flight ``apiFetch`` / proxy
  // ``fetch`` calls. The token-ref guard above is the second layer —
  // some browser/runtime versions don't propagate aborts to all of
  // ``apiFetch``'s internal fetches cleanly, so we never trust the
  // abort alone.
  const importAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [authLoading, user, router]);

  // Abort any in-flight import on unmount so a mid-import navigation
  // doesn't fire React's "state update on unmounted component" warning
  // (or worse, leak the in-flight ``fetch`` until its 15s timeout).
  // The ``isCurrent`` guards inside ``applyTweetImport`` also catch
  // this, but the explicit abort tears down the open sockets faster
  // and silences the warning.
  useEffect(() => {
    return () => {
      importAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    apiFetch<Tag[]>("/tags")
      .then(setTags)
      .catch(() => {});
  }, []);

  // Load the bounty being fulfilled — pre-fill + lock the inherited
  // fields. The server is authoritative on these (it ignores divergent
  // values when bounty_id is present), but locking is the UX cue.
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

  // Possible-duplicate probe. Fires whenever the four signal fields
  // (coords, source URL, event date) change, after a short idle
  // debounce. The backend tolerates partial / malformed inputs (a
  // half-typed source URL just disables the host leg, a bad date
  // does the same for the date leg, no usable leg → empty array)
  // so it's safe to call eagerly while the user is still typing.
  //
  // The bounty-fulfilment path skips the probe entirely: the bounty
  // is the authoritative trace, "duplicating a bounty" doesn't apply
  // (and the source URL is locked to the bounty's anyway, so the
  // host leg would re-surface the bounty itself as a candidate).
  useEffect(() => {
    if (lockedFromBounty) return;
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    // Need coords at minimum — proximity is the always-on leg. If
    // both source URL and event date are still empty, the backend
    // will return [] anyway; we drop here to skip the round trip.
    if (
      Number.isNaN(latNum) ||
      Number.isNaN(lngNum) ||
      latNum < -90 ||
      latNum > 90 ||
      lngNum < -180 ||
      lngNum > 180
    ) {
      setPossibleDuplicates([]);
      return;
    }
    if (!sourceUrl && !eventDate) {
      setPossibleDuplicates([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        lat: latNum.toString(),
        lng: lngNum.toString(),
      });
      if (sourceUrl) params.set("source_url", sourceUrl);
      if (eventDate) params.set("event_date", eventDate);
      apiFetch<PossibleDuplicate[]>(
        `/geolocations/possible-duplicates?${params.toString()}`,
        { signal: controller.signal },
      )
        .then((hits) => {
          if (controller.signal.aborted) return;
          setPossibleDuplicates(hits);
        })
        .catch(() => {
          // Soft warning — silently drop on any failure (429 rate
          // limit from rapid edits, 5xx, network blip). The form
          // remains submittable; we're not blocking on this signal.
          //
          // Deliberately do NOT clear the previous result here: a
          // transient 429 mid-typing would otherwise wipe a warning
          // the analyst was already looking at, with no explanation.
          // The next successful fetch overwrites; if no fetch ever
          // succeeds the analyst sees a stale-but-truthful list (the
          // candidates were real at the moment they were fetched).
        });
    }, DUPLICATE_PROBE_DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [lat, lng, sourceUrl, eventDate, lockedFromBounty]);

  // ── Tweet-import wiring ────────────────────────────────────────────────
  //
  // Pulls the parsed payload into form state. Two design rules drive
  // the split:
  //
  // * SOURCE URL — set to the quoted tweet's URL when the OP quote-
  //   retweets (the OSINT-correct attribution: the analyst is the
  //   messenger, not the source). When there's no quote, the backend
  //   tries the first non-X URL in ``entities.urls`` (analyst typed
  //   ``Source: t.me/<channel>/<id>`` or similar in the body); if
  //   nothing usable surfaces, it falls back to the OP's own URL so
  //   the form is at least filled — the analyst should normally
  //   override this to the real source.
  // * MEDIA SPLIT — uniform rule across OP and quoted tweet:
  //   videos → primary (lands in ``files[]``), images → proof
  //   (uploaded to ``/proof-images``, embedded inline in the Tiptap
  //   doc). When the import yields no video at all, no primary media
  //   is loaded — the analyst attaches the source media manually.
  //   This is intentional: most analyst tweets are image-only proof,
  //   so guessing "first image as primary" would systematically
  //   mis-label the analyst's annotation as the source footage.
  //   Note: the syndication endpoint doesn't expose reply-chain media,
  //   so a video the analyst posted in a reply is invisible here.
  //
  // All upstream X CDN URLs are pulled via the backend proxy
  // ``/geolocations/import-from-tweet/media`` because the X CDN doesn't
  // set the CORS headers a browser ``fetch`` would need. The proxy is
  // whitelisted to ``pbs.twimg.com`` / ``video.twimg.com`` so a hostile
  // or schema-drifted ``remote_url`` can't open it to arbitrary
  // outbound fetches.

  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "";

  const fetchProxyBlob = async (
    remoteUrl: string,
    signal: AbortSignal
  ): Promise<{ blob: Blob; contentType: string } | null> => {
    try {
      const proxyUrl = `/geolocations/import-from-tweet/media?u=${encodeURIComponent(remoteUrl)}`;
      const res = await fetch(`${apiBase}${proxyUrl}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) return null;
      const blob = await res.blob();
      const contentType =
        res.headers.get("content-type") ?? blob.type ?? "application/octet-stream";
      return { blob, contentType };
    } catch {
      // AbortError or network failure — caller treats null as "skip
      // this one" so the import continues for the other media items.
      return null;
    }
  };

  const makeFile = (
    fetched: { blob: Blob; contentType: string },
    media: TweetImportMedia,
    tweetId: string,
    index: number
  ): File => {
    const guessedExt =
      media.remote_url.match(/\.([a-z0-9]{3,4})(?:$|\?)/i)?.[1] ??
      (media.kind === "video" ? "mp4" : "jpg");
    const filename = `tweet-${tweetId}-${index}.${guessedExt}`;
    return new File([fetched.blob], filename, { type: fetched.contentType });
  };

  /**
   * Upload an X-CDN image into ``/proof-images`` so it can be embedded
   * inline in the Tiptap doc. Returns the public proof-image URL on
   * success, ``null`` on any failure (we never block the import on a
   * single proof-image upload — the analyst can re-attach manually).
   */
  const uploadAsProofImage = async (
    remoteUrl: string,
    signal: AbortSignal
  ): Promise<string | null> => {
    const fetched = await fetchProxyBlob(remoteUrl, signal);
    if (fetched === null) return null;
    const ext =
      remoteUrl.match(/\.([a-z0-9]{3,4})(?:$|\?)/i)?.[1] ?? "jpg";
    const fd = new FormData();
    fd.append(
      "file",
      new File([fetched.blob], `tweet-proof.${ext}`, {
        type: fetched.contentType,
      })
    );
    try {
      const result = await apiFetch<{ url: string }>(
        "/geolocations/proof-images",
        { method: "POST", body: fd, signal }
      );
      return result.url;
    } catch {
      return null;
    }
  };

  const buildSeedProof = (
    parsed: TweetImportResponse,
    proofImageUrls: string[]
  ) => {
    const content: Record<string, unknown>[] = [];
    // OP author + their commentary
    content.push({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: `Geolocation by @${parsed.author_handle} — ${parsed.tweet_text}`.trim(),
        },
      ],
    });
    // Source attribution (when there's a quoted tweet)
    if (parsed.quoted_tweet !== null) {
      content.push({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: `Source: @${parsed.quoted_tweet.author_handle} — ${parsed.quoted_tweet.tweet_text}`.trim(),
          },
        ],
      });
    }
    // Inline proof images
    for (const url of proofImageUrls) {
      content.push({ type: "image", attrs: { src: url } });
    }
    return { type: "doc", content };
  };

  /**
   * Split media by TYPE: videos → primary (``files[]``), images →
   * proof (``/proof-images`` + inline embed). Uniform across OP and
   * quoted tweet — the ``origin`` field on the payload is preserved
   * for the proof-body attribution but doesn't change which bucket
   * the media lands in. When there's no video, ``primary`` is empty
   * and the analyst attaches the source media manually.
   */
  const splitMedia = (
    media: TweetImportMedia[]
  ): { primary: TweetImportMedia[]; proof: TweetImportMedia[] } => ({
    primary: media.filter((m) => m.kind === "video"),
    proof: media.filter((m) => m.kind === "image"),
  });

  const applyTweetImport = async (parsed: TweetImportResponse) => {
    // Cancel any in-flight import + bump the token so the previous
    // ``applyTweetImport`` invocation, if still running, will see its
    // captured ``localToken`` diverge from ``importTokenRef.current``
    // and bail before clobbering state.
    importAbortRef.current?.abort();
    importTokenRef.current += 1;
    const localToken = importTokenRef.current;
    const controller = new AbortController();
    importAbortRef.current = controller;
    const isCurrent = () =>
      importTokenRef.current === localToken && !controller.signal.aborted;

    if (parsed.suggested_title) setTitle(parsed.suggested_title);
    if (parsed.source_url) setSourceUrl(parsed.source_url);
    if (parsed.posted_at) {
      const d = new Date(parsed.posted_at);
      if (!Number.isNaN(d.getTime())) {
        setEventDate(d.toISOString().slice(0, 10));
      }
    }
    if (parsed.parsed_coords.length > 0) {
      const [first, ...rest] = parsed.parsed_coords;
      setLat(first.lat.toString());
      setLng(first.lng.toString());
      setExtraCoordCandidates(rest);
    } else {
      setExtraCoordCandidates([]);
    }

    // Split media; download primary into ``files[]``, upload proof
    // images to ``/proof-images`` and embed them in the seed proof body.
    const { primary, proof: proofMedia } = splitMedia(parsed.media);
    const tweetId =
      parsed.original_tweet_url.split("/").pop() ?? "tweet";

    const primaryFiles: File[] = [];
    for (let i = 0; i < primary.length; i++) {
      if (!isCurrent()) return;
      const m = primary[i];
      const fetched = await fetchProxyBlob(m.remote_url, controller.signal);
      if (fetched === null) continue;
      primaryFiles.push(makeFile(fetched, m, tweetId, i));
    }
    if (!isCurrent()) return;
    if (primaryFiles.length > 0) setFiles(primaryFiles);

    // ``proofMedia`` is already image-only by ``splitMedia``.
    const proofImageUrls: string[] = [];
    for (const m of proofMedia) {
      if (!isCurrent()) return;
      const url = await uploadAsProofImage(m.remote_url, controller.signal);
      if (url !== null) proofImageUrls.push(url);
    }
    if (!isCurrent()) return;

    setProof(buildSeedProof(parsed, proofImageUrls));
    setImportedFrom(parsed.author_handle || "unknown");
    // Bump the render-visible generation so the editor key changes
    // even when the author handle is the same as the previous import.
    setImportGen((g) => g + 1);
  };

  const clearImportedTweet = () => {
    // Cancel any still-running import so its trailing ``setFiles`` /
    // ``setProof`` doesn't repopulate the form after we just emptied it.
    importAbortRef.current?.abort();
    importTokenRef.current += 1;
    setImportedFrom(null);
    setExtraCoordCandidates([]);
    setTitle("");
    setLat("");
    setLng("");
    setSourceUrl("");
    setEventDate("");
    setFiles([]);
    setProof(null);
  };

  const swapCoordCandidate = (candidate: { lat: number; lng: number }) => {
    const prevLat = parseFloat(lat);
    const prevLng = parseFloat(lng);
    setLat(candidate.lat.toString());
    setLng(candidate.lng.toString());
    setExtraCoordCandidates((prev) => {
      const next = prev.filter(
        (c) => c.lat !== candidate.lat || c.lng !== candidate.lng
      );
      if (!Number.isNaN(prevLat) && !Number.isNaN(prevLng)) {
        next.push({ lat: prevLat, lng: prevLng });
      }
      return next;
    });
  };

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

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
    // When fulfilling a bounty, the bounty's media transfers in — caller
    // doesn't have to add new files. Otherwise at least one file is
    // required (same contract as before).
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
    // Required curated categories — mirrors the server-side check in
    // `routers/geolocations.py::create_geolocation`, surfaced here so the
    // analyst gets the message inline instead of as a 400 after upload.
    //
    // If the curated taxonomy never loaded, the two required selectors
    // render empty — distinguish that from "didn't pick one" so the
    // analyst gets a recoverable message, not a dead-end "Select a
    // conflict" with no chips to click.
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

  // Bounty referenced but still loading — block the form until we
  // know the title / source / tags to pre-fill.
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
          {/* Tweet-import shortcut. Hidden in bounty-fulfilment mode —
              the bounty's source URL + media are locked there, so the
              pre-fill has nothing to land in. */}
          {!lockedFromBounty && (
            <TweetImportBanner
              onImported={applyTweetImport}
              onClear={clearImportedTweet}
              importedFrom={importedFrom}
              linkedX={user?.external_links?.x ?? null}
            />
          )}

          {/* Where & when */}
          <section className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-4">
            <header className="space-y-1">
              <h2 className="text-sm font-medium text-neutral-200">
                Where &amp; when
              </h2>
              <p className="text-xs text-neutral-500">
                Title, coordinates, original source, and the date the event
                happened.
              </p>
            </header>

            <div className="space-y-1.5">
              <label htmlFor="title" className={FORM_LABEL}>
                Title
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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="lat" className={FORM_LABEL}>
                  Latitude
                </label>
                <input
                  id="lat"
                  type="text"
                  required
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  placeholder="48.015883"
                  className={`${FORM_INPUT} font-mono`}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="lng" className={FORM_LABEL}>
                  Longitude
                </label>
                <input
                  id="lng"
                  type="text"
                  required
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  placeholder="37.802411"
                  className={`${FORM_INPUT} font-mono`}
                />
              </div>
            </div>
            {extraCoordCandidates.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-neutral-500">Also detected:</span>
                {extraCoordCandidates.map((c, i) => (
                  <button
                    key={`${c.lat}-${c.lng}-${i}`}
                    type="button"
                    onClick={() => swapCoordCandidate(c)}
                    className="font-mono px-2 py-0.5 rounded-md bg-neutral-800 text-orange-400 hover:bg-neutral-700 transition-colors"
                  >
                    {c.lat.toFixed(5)}, {c.lng.toFixed(5)} ↺
                  </button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="source_url" className={FORM_LABEL}>
                  Source URL {lockedFromBounty && <LockedHint />}
                </label>
                <input
                  id="source_url"
                  type="url"
                  required
                  readOnly={lockedFromBounty}
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://t.me/channel/12345"
                  className={lockedFromBounty ? FORM_INPUT_LOCKED : FORM_INPUT}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="event_date" className={FORM_LABEL}>
                  Event date
                </label>
                <input
                  id="event_date"
                  type="date"
                  required
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className={FORM_INPUT}
                />
              </div>
            </div>
          </section>

          {/* Source media */}
          <section className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-4">
            <header className="space-y-1">
              <h2 className="text-sm font-medium text-neutral-200">
                Source media {lockedFromBounty && <LockedHint />}
              </h2>
              <p className="text-xs text-neutral-500">
                {lockedFromBounty
                  ? "The bounty's media transfers to this geolocation on submit. No need to re-upload."
                  : "The original footage being geolocated (typically a video). Analyst-annotated screenshots belong in the proof section below."}
              </p>
            </header>

            {lockedFromBounty ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {bounty!.media.map((m) => (
                  <div
                    key={m.id}
                    className="relative aspect-video rounded-md overflow-hidden bg-neutral-800 border border-neutral-800"
                  >
                    {m.media_type === "image" ? (
                      // 3-up grid inside max-w-4xl ≈ 250 CSS px wide.
                      // ``thumbnail`` is the right fit and keeps the
                      // submit-form preview cheap (re-fetched on every
                      // bounty-fulfilment landing).
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={displayUrlsFor(m).thumbnail}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <video
                        src={m.storage_url}
                        className="w-full h-full object-cover"
                        muted
                      />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label htmlFor="files" className={FORM_LABEL}>
                    Files
                  </label>
                  <input
                    id="files"
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
                    onChange={handleFiles}
                    className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-neutral-300 text-sm file:mr-4 file:py-1 file:px-3 file:rounded-sm file:border-0 file:bg-neutral-700 file:text-neutral-300 file:cursor-pointer"
                  />
                </div>
                {files.length > 0 && (
                  <FilePreviewGrid files={files} />
                )}
              </div>
            )}
          </section>

          {/* Tags */}
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

          {/* Proof */}
          <section className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-4">
            <header className="space-y-1">
              <h2 className="text-sm font-medium text-neutral-200">Proof</h2>
              <p className="text-xs text-neutral-500">
                Annotated cross-reference between the source media and a map
                screenshot. Highlight matching anchor points with coloured
                boxes.
              </p>
            </header>

            {/* Re-mount the editor on every import (and on Clear, which
                resets ``importedFrom`` to null). The generation
                counter changes even when the imported author handle is
                the same as the previous import — necessary because a
                same-author re-import would otherwise leave the
                ``key`` unchanged and Tiptap would keep its existing
                content despite the new ``initialContent`` prop. */}
            <ProofEditor
              key={importedFrom !== null ? `import-${importGen}` : "blank"}
              initialContent={importedFrom ? proof : null}
              onChange={setProof}
              onUploadStateChange={setProofImageUploading}
            />
          </section>

          {possibleDuplicates.length > 0 && (
            <DuplicateWarning hits={possibleDuplicates} />
          )}

          {/* Submit-validation errors render next to the button — not at
              the top of this long form — so a failed submit is visible
              without scrolling back up. Every `error` on this form is set
              by handleSubmit, so the button is the right anchor. */}
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

/**
 * Inline soft-warning rendered above the submit button when the
 * duplicate probe surfaces candidates. Each row links to the existing
 * geolocation in a new tab so the analyst can sanity-check without
 * losing the in-progress form. Never blocks — the submit button stays
 * enabled; this is a "did you mean…" signal, not a gate.
 *
 * Palette split per `design.md`: the outer card stays amber (the
 * "warning, not error" semantic — same idiom as the gate page's
 * notification panel), but every clickable affordance inside is
 * orange. Without that split the card would violate the "if it's
 * clickable, it's orange" rule that the rest of the app reads by.
 */
function DuplicateWarning({ hits }: { hits: PossibleDuplicate[] }) {
  return (
    <section
      className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 space-y-3"
      aria-live="polite"
    >
      <header className="flex items-start gap-2 text-amber-200">
        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h2 className="text-sm font-medium">
            {hits.length === 1
              ? "1 possibly related geolocation"
              : `${hits.length} possibly related geolocations`}
          </h2>
          <p className="text-xs text-amber-200/80">
            Same area + matching source or event date. Check before
            submitting — submission isn&apos;t blocked.
          </p>
        </div>
      </header>
      <ul className="space-y-1.5">
        {hits.map((hit) => (
          <li key={hit.id}>
            <Link
              href={`/geolocations/${hit.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 px-3 py-2 bg-neutral-900/60 border border-neutral-700 rounded-md hover:border-orange-500/50 hover:bg-neutral-900 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-neutral-100 truncate">
                  {hit.title}
                </p>
                <p className="text-xs text-neutral-400">
                  {formatDate(hit.event_date)} · @{hit.author.username} ·{" "}
                  {formatDistance(hit.distance_m)}
                </p>
              </div>
              <span className="text-xs text-orange-400 shrink-0">
                Open ↗
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Render a metres distance compactly. <1km → "N m" rounded to 10m
 * (the GPS jitter floor for phone-grade coords), ≥1km → "N.N km"
 * with one decimal. Negative values are clamped to 0 (the backend
 * never returns negative distances, but a stray ``-0.0`` from a
 * float round-trip would print as "-0 m").
 *
 * The threshold compares the post-rounding value, not the raw
 * input: 995 m rounds to 1000 m, which should render as "1.0 km"
 * — not the contradictory "1000 m". Switching at the rounded
 * boundary avoids that artefact at the km/m crossover.
 */
function formatDistance(distanceM: number): string {
  const clamped = Math.max(0, distanceM);
  const rounded10m = Math.round(clamped / 10) * 10;
  if (rounded10m < 1000) {
    return `${rounded10m} m`;
  }
  return `${(clamped / 1000).toFixed(1)} km`;
}

function LockedHint() {
  return (
    <span className="inline-flex items-center gap-1 ml-1.5 text-[10px] normal-case tracking-normal text-neutral-500">
      <Lock size={10} />
      from bounty
    </span>
  );
}
