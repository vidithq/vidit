"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { ApiError, apiFetch } from "@/lib/api";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { WARNING_CALLOUT } from "@/components/ui/styles";
import type { TweetImportResponse } from "@/types";


/**
 * Normalise a free-form X handle to a lowercase comparison key, or ``null``.
 * Accepts ``@kalush``, ``kalush``, ``x.com/kalush``, the ``https://`` form, and
 * the ``twitter.com`` host, so a soft match still works.
 */
function normaliseHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  s = s.replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, "");
  s = s.replace(/^@/, "").replace(/\/+$/, "").trim();
  // First path segment only — drops a pasted ``kalush/status/123`` tail.
  s = s.split("/")[0];
  if (!s) return null;
  return s.toLowerCase();
}

export type AuthorshipState = "match" | "no_link" | "different";

/**
 * Compare the parsed tweet's author to the analyst's ``external_links.x``:
 * ``no_link`` (no X linked), ``different`` (linked but mismatched), ``match``.
 * Never blocks the import. The link is unverified, so this is anti-honest-
 * mistake, not anti-theft — the visible warning is the deterrent.
 */
export function authorshipState(
  linkedX: string | null | undefined,
  tweetAuthor: string
): AuthorshipState {
  const linked = normaliseHandle(linkedX);
  const tweet = normaliseHandle(tweetAuthor);
  if (!linked) return "no_link";
  if (!tweet) return "no_link"; // no handle to compare against → behave like no link
  return linked === tweet ? "match" : "different";
}

/**
 * Single-input banner that front-loads the submit form: paste a tweet URL, the
 * parent populates title / source / event date / media / coordinates. A
 * shortcut, not an authority — the analyst still reviews and submits.
 *
 * Hidden in bounty-fulfilment mode (source URL + media are locked to the
 * bounty, so a pre-fill has nothing to land in). The fetch + state population
 * live in the parent so the form keeps one source of truth per field — see
 * ``frontend/src/app/submit/page.tsx``.
 */
export function TweetImportBanner({
  onImported,
  onClear,
  importedFrom,
  linkedX,
}: {
  /** Parent maps the parsed payload into form state and tells us
   *  whether to flip into the "Imported from @x" confirmation slot. */
  onImported: (parsed: TweetImportResponse) => Promise<void> | void;
  /** Parent resets every field the banner populated. */
  onClear: () => void;
  /** Author handle on the most recent successful import, or null when
   *  the banner is in its initial state. */
  importedFrom: string | null;
  /** The analyst's linked X handle (``external_links.x``), for the soft
   *  authorship guardrail: a mismatch or missing link surfaces a heads-up.
   *  A friction signal, not a gate — the link is unverified. */
  linkedX: string | null;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runImport = async () => {
    if (!url || busy) return;
    setError(null);
    setBusy(true);
    try {
      const parsed = await apiFetch<TweetImportResponse>(
        "/geolocations/import-from-tweet",
        { method: "POST", body: JSON.stringify({ url }) }
      );
      await onImported(parsed);
      // Keep ``url`` populated so the post-import view shows it in-place.
    } catch (err) {
      // Render ``ApiError.detail`` verbatim — the backend already speaks
      // analyst-friendly English for 400 / 404 / 502.
      const message =
        err instanceof ApiError ? err.message : "Couldn't import tweet";
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  // Enter triggers Import without a <form>: this banner sits inside the page's
  // outer <form>, and a nested <form> is invalid HTML — the browser binds the
  // inner submit to the outer form, submitting the geolocation by accident.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void runImport();
    }
  };

  // Same layout pre and post import (only the button label + input disabled
  // state change). An earlier swap-to-a-different-section approach flickered
  // visibly on the recorded screen capture even at matching height.
  const imported = importedFrom !== null;
  const state = imported ? authorshipState(linkedX, importedFrom) : "match";
  return (
    <div className="space-y-3">
      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}
      {/* Pre-import nudge surfaces the no-linked-X signal before the analyst
          pastes; post-import, ``AuthorshipWarning`` covers it more pointedly. */}
      {!imported && !linkedX && <AuthorshipNudgeNoLink />}
      {imported && state !== "match" && (
        <AuthorshipWarning
          state={state}
          tweetAuthor={importedFrom}
          linkedX={linkedX}
        />
      )}
      <div className="flex gap-2">
        <Input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="https://x.com/handle/status/…"
          disabled={busy || imported}
        />
        <Button
          variant="primary"
          onClick={() => (imported ? onClear() : void runImport())}
          disabled={busy || (!imported && !url)}
          className="whitespace-nowrap"
        >
          {imported ? "Imported!" : busy ? "Importing…" : "Import"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Soft authorship warning after a successful import. Two shapes:
 * ``no_link`` (no linked X — can't compare) and ``different`` (linked handle
 * ≠ tweet author; names both so an accidental colleague-URL paste self-
 * corrects on sight). Amber = caution, not error: the import succeeded and
 * submission isn't blocked.
 */
function AuthorshipWarning({
  state,
  tweetAuthor,
  linkedX,
}: {
  state: AuthorshipState;
  tweetAuthor: string;
  linkedX: string | null;
}) {
  const linkedHandle = normaliseHandle(linkedX);
  return (
    <div
      className={`rounded-md p-3 flex items-start gap-2 text-xs ${WARNING_CALLOUT}`}
      aria-live="polite"
    >
      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
      <div className="space-y-1">
        {state === "different" ? (
          <p>
            Heads up: the tweet was posted by{" "}
            <span className="font-medium">@{tweetAuthor}</span>, but your
            linked X account is{" "}
            <span className="font-medium">@{linkedHandle}</span>. Only
            publish work you authored yourself or have explicit
            permission to reproduce.
          </p>
        ) : (
          <p>
            Heads up: you haven&apos;t linked an X account to your
            Vidit profile, so we can&apos;t check that this tweet is
            yours. Only publish work you authored yourself or have
            explicit permission to reproduce.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Tighter ``AuthorshipWarning`` shown before import, on the empty banner, when
 * no X handle is linked. Nudges the analyst to link one (or accept they won't
 * get the match check on their own work).
 */
function AuthorshipNudgeNoLink() {
  return (
    <div className="text-xs text-neutral-500 flex items-start gap-1.5">
      <AlertTriangle size={12} className="shrink-0 mt-0.5 text-amber-400/70" />
      <span>
        No X account linked on your{" "}
        <a
          href="/settings"
          className="text-orange-400 hover:text-orange-300 transition-colors underline-offset-2 hover:underline"
        >
          profile
        </a>
        . We&apos;ll flag a heads-up on import to make sure you have
        permission to publish the tweet.
      </span>
    </div>
  );
}
