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
 * Form-field bindings the import writes through. ``lat`` / ``lng`` are
 * current values (``swapCoordCandidate`` reads them so the displaced pair
 * re-joins the candidate chips); the rest are setters.
 */
interface TweetImportFormBindings {
  lat: string;
  lng: string;
  setTitle: (v: string) => void;
  setLat: (v: string) => void;
  setLng: (v: string) => void;
  setSourceUrl: (v: string) => void;
  setEventDate: (v: string) => void;
  setSourcePostedAt: (v: string) => void;
  setFiles: (files: File[]) => void;
  setProof: (proof: Record<string, unknown> | null) => void;
}

/**
 * Owns the tweet-import lifecycle: applying a parsed payload (staged —
 * text fields land immediately, media trails in as it downloads),
 * clearing it, and the coordinate swap chips. Pure pipeline steps live
 * in `lib/tweetImport`.
 */
export function useTweetImport(form: TweetImportFormBindings) {
  // Banner state: handle of the most recent successful import, plus the
  // extra coordinate candidates surfaced as swap chips when the parser
  // found more than one.
  const [importedFrom, setImportedFrom] = useState<string | null>(null);
  const [extraCoordCandidates, setExtraCoordCandidates] = useState<
    TweetImportCoord[]
  >([]);
  // Bumped on every Import / Clear. ``applyTweetImport`` captures the
  // value at start as its "import id"; if it diverges before a state
  // write, a slow import (downloading + uploading N media) bails instead
  // of applying stale state.
  const importTokenRef = useRef(0);
  // Render-visible companion to ``importTokenRef`` (refs don't re-render).
  // The ``ProofEditor`` ``key`` reads it so a same-author re-import still
  // forces a clean re-mount; keyed on the handle alone, the editor would
  // silently keep its previous content.
  const [importGen, setImportGen] = useState(0);
  // Aborts in-flight fetches; Clear and re-Import both abort the previous
  // controller. The token-ref guard above is a second layer because some
  // browsers don't propagate aborts to all of ``apiFetch``'s internal
  // fetches, so we never trust the abort alone.
  const importAbortRef = useRef<AbortController | null>(null);

  // Abort in-flight imports on unmount: the ``isCurrent`` guards also
  // catch a mid-import navigation, but the explicit abort tears down open
  // sockets faster (else the ``fetch`` leaks until its 15s timeout) and
  // silences React's "state update on unmounted component" warning.
  useEffect(() => {
    return () => {
      importAbortRef.current?.abort();
    };
  }, []);

  const applyTweetImport = async (parsed: TweetImportResponse) => {
    // Cancel any in-flight import + bump the token so a still-running
    // invocation sees its ``localToken`` diverge and bails.
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
        // The imported tweet is the source on this path, so its post time
        // pre-fills the (required) source instant.
        form.setSourcePostedAt(d.toISOString().slice(0, 16));
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
    // Bump so the editor key changes even on a same-author re-import.
    setImportGen((g) => g + 1);
  };

  const clearImportedTweet = () => {
    // Cancel any still-running import so its trailing ``setFiles`` /
    // ``setProof`` doesn't refill the form we just emptied.
    importAbortRef.current?.abort();
    importTokenRef.current += 1;
    setImportedFrom(null);
    setExtraCoordCandidates([]);
    form.setTitle("");
    form.setLat("");
    form.setLng("");
    form.setSourceUrl("");
    form.setEventDate("");
    form.setSourcePostedAt("");
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
