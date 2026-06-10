"use client";

import { useEffect, useRef, useState } from "react";

import type { TweetImportCoord, TweetImportResponse } from "@/types";
import {
  buildSeedProof,
  fetchProxyBlob,
  makeFile,
  splitMedia,
  uploadAsProofImage,
} from "@/lib/tweetImport";

/**
 * Form-field bindings the import writes through. ``lat`` / ``lng``
 * are the current values (read by ``swapCoordCandidate`` so the
 * displaced pair re-joins the candidate chips); the rest are setters.
 */
interface TweetImportFormBindings {
  lat: string;
  lng: string;
  setTitle: (v: string) => void;
  setLat: (v: string) => void;
  setLng: (v: string) => void;
  setSourceUrl: (v: string) => void;
  setEventDate: (v: string) => void;
  setFiles: (files: File[]) => void;
  setProof: (proof: Record<string, unknown> | null) => void;
}

/**
 * Owns the tweet-import lifecycle on the submit form: applying a
 * parsed payload to the form (staged — text fields land immediately,
 * media trails in as it downloads), clearing it, and the coordinate
 * swap chips. The pure pipeline steps live in `lib/tweetImport`.
 */
export function useTweetImport(form: TweetImportFormBindings) {
  // Tweet-import banner state: handle of the most recent successful
  // import (drives the "Imported from @x — clear" confirmation slot)
  // and the extra coordinate candidates surfaced as swap chips when
  // the parser found more than one.
  const [importedFrom, setImportedFrom] = useState<string | null>(null);
  const [extraCoordCandidates, setExtraCoordCandidates] = useState<
    TweetImportCoord[]
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

    if (parsed.suggested_title) form.setTitle(parsed.suggested_title);
    if (parsed.source_url) form.setSourceUrl(parsed.source_url);
    if (parsed.posted_at) {
      const d = new Date(parsed.posted_at);
      if (!Number.isNaN(d.getTime())) {
        form.setEventDate(d.toISOString().slice(0, 10));
      }
    }
    if (parsed.parsed_coords.length > 0) {
      const [first, ...rest] = parsed.parsed_coords;
      form.setLat(first.lat.toString());
      form.setLng(first.lng.toString());
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
    if (primaryFiles.length > 0) form.setFiles(primaryFiles);

    // ``proofMedia`` is already image-only by ``splitMedia``.
    const proofImageUrls: string[] = [];
    for (const m of proofMedia) {
      if (!isCurrent()) return;
      const url = await uploadAsProofImage(m.remote_url, controller.signal);
      if (url !== null) proofImageUrls.push(url);
    }
    if (!isCurrent()) return;

    form.setProof(buildSeedProof(parsed, proofImageUrls));
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
    form.setTitle("");
    form.setLat("");
    form.setLng("");
    form.setSourceUrl("");
    form.setEventDate("");
    form.setFiles([]);
    form.setProof(null);
  };

  const swapCoordCandidate = (candidate: TweetImportCoord) => {
    const prevLat = parseFloat(form.lat);
    const prevLng = parseFloat(form.lng);
    form.setLat(candidate.lat.toString());
    form.setLng(candidate.lng.toString());
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

  return {
    importedFrom,
    importGen,
    extraCoordCandidates,
    applyTweetImport,
    clearImportedTweet,
    swapCoordCandidate,
  };
}
