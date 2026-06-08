"use client";

import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { ApiError, apiFetch } from "@/lib/api";
import { FORM_ERROR_BANNER, FORM_INPUT } from "@/components/ui/form-styles";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import type { TweetImportResponse } from "@/types";


/**
 * Normalise an X handle for case-insensitive comparison. The analyst's
 * ``external_links.x`` is free-form (we never verified it) — accept
 * ``@kalush``, ``kalush``, ``x.com/kalush``, ``https://x.com/kalush``,
 * and ``https://twitter.com/kalush`` so a soft match still works. Returns
 * the lowercase handle or ``null`` if the input doesn't carry one we
 * can extract.
 */
function normaliseHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  // Strip protocol + host so the URL forms collapse to a path.
  s = s.replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, "");
  // Strip leading @ and trailing slashes / spaces.
  s = s.replace(/^@/, "").replace(/\/+$/, "").trim();
  // Take the first path segment — anything after a slash is not the
  // handle (e.g. ``kalush/status/123`` if the analyst pasted a full
  // tweet URL into the profile field).
  s = s.split("/")[0];
  if (!s) return null;
  return s.toLowerCase();
}

export type AuthorshipState = "match" | "no_link" | "different";

/**
 * Compare the parsed tweet's author handle to the analyst's
 * ``external_links.x``. Returns ``no_link`` when the analyst hasn't
 * linked an X account at all, ``different`` when they have but it
 * doesn't match the tweet author, and ``match`` otherwise. This is a
 * soft warning surface — never blocks the import. The analyst's link
 * isn't verified, so this is anti-honest-mistake rather than
 * anti-work-stealing on its own; the visible warning is the deterrent.
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
 * Single-input banner that front-loads typing on the submit form: paste
 * a tweet URL, the parent populates title / source / event date / media
 * / best-effort coordinates. The analyst still reviews and submits — this
 * is a shortcut, not an authority.
 *
 * Hidden when the parent form is in bounty-fulfilment mode (source URL +
 * media are locked to the bounty in that case, so a tweet pre-fill has
 * nothing to land in).
 *
 * The actual fetch / state population lives in the parent so the form
 * keeps a single source of truth for every field — see
 * ``frontend/src/app/geolocations/new/page.tsx``.
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
  /** The analyst's currently-linked X handle (``external_links.x``).
   *  Used to render a soft authorship guardrail on import: if the
   *  tweet author doesn't match — or the analyst hasn't linked any X
   *  account — we surface a heads-up note. Never blocks the import,
   *  because the link itself is unverified; this is a friction signal,
   *  not a gate. */
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
      setUrl("");
    } catch (err) {
      // ``ApiError`` carries the server's ``detail`` text — render it
      // verbatim. For 400 / 404 / 502 the backend already speaks
      // analyst-friendly English ("Not a tweet URL", "Tweet not
      // accessible", "Couldn't read tweet — fill the form manually"),
      // so we don't translate here.
      const message =
        err instanceof ApiError ? err.message : "Couldn't import tweet";
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  // Enter-key triggers Import without a form element — the banner
  // lives inside the page's outer <form>, and nested forms are
  // invalid HTML: the browser treats the inner submit button as
  // belonging to the outer form, so a real <form onSubmit> here
  // would submit the geolocation form by accident.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void runImport();
    }
  };

  if (importedFrom !== null) {
    const state = authorshipState(linkedX, importedFrom);
    // Keep the post-import section structurally aligned with the
    // pre-import one — same header + a one-row content block where the
    // input used to be — so the boundary reads as a content swap rather
    // than a layout collapse.
    return (
      <section className="bg-neutral-900 rounded-lg border border-neutral-700 p-4 space-y-3">
        <header className="space-y-1">
          <h2 className="text-sm font-medium text-neutral-200">
            Tweet imported
          </h2>
          <p className="text-xs text-neutral-500">
            Title, source, event date, media and best-effort coordinates
            were pre-filled from{" "}
            <span className="text-neutral-300">@{importedFrom}</span>.
            Review and submit.
          </p>
        </header>
        {state !== "match" && (
          <AuthorshipWarning state={state} tweetAuthor={importedFrom} linkedX={linkedX} />
        )}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 transition-colors"
          >
            <X size={12} />
            Clear
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-neutral-900 rounded-lg border border-neutral-700 p-4 space-y-3">
      <header className="space-y-1">
        <h2 className="text-sm font-medium text-neutral-200">
          Paste a tweet URL
        </h2>
        <p className="text-xs text-neutral-500">
          Pre-fills title, source, event date, media, and best-effort
          coordinates from a public tweet. You review and submit.
        </p>
      </header>
      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}
      {/* Pre-import nudge: surface the same authorship signal *before*
          the analyst pastes anything, so the constraint is visible up
          front rather than as a surprise after the round trip. Only
          when the analyst hasn't linked an X handle at all — once
          they have one, the post-import "different account" warning
          covers the meaningful failure mode. */}
      {!linkedX && (
        <AuthorshipNudgeNoLink />
      )}
      <div className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="https://x.com/handle/status/…"
          className={FORM_INPUT}
          disabled={busy}
        />
        <button
          type="button"
          onClick={() => void runImport()}
          disabled={busy || !url}
          className={`px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50 whitespace-nowrap ${PRIMARY_BUTTON}`}
        >
          {busy ? "Importing…" : "Import"}
        </button>
      </div>
    </section>
  );
}

/**
 * Soft authorship warning rendered after a successful import. Two
 * shapes, one component:
 *
 * * ``no_link`` — analyst hasn't filled in ``external_links.x`` on
 *   their profile, so we can't compare at all. Reminds them that
 *   importing somebody else's tweet is OK if it's their own work or
 *   they have permission, and points at the settings page.
 * * ``different`` — analyst has an X handle linked but the tweet was
 *   posted by someone else. Mentions both handles by name so the
 *   nature of the mismatch is obvious; the most common honest case
 *   (analyst pasted a colleague's URL by accident) self-corrects on
 *   sight.
 *
 * Amber palette mirrors the duplicate-warning card on the same form:
 * caution, not error — the import already succeeded and submission is
 * not blocked.
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
      className="bg-amber-500/10 border border-amber-500/30 rounded-md p-3 flex items-start gap-2 text-xs text-amber-200"
      aria-live="polite"
    >
      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
      <div className="space-y-1">
        {state === "different" ? (
          <p>
            Heads up — the tweet was posted by{" "}
            <span className="font-medium">@{tweetAuthor}</span>, but your
            linked X account is{" "}
            <span className="font-medium">@{linkedHandle}</span>. Only
            publish work you authored yourself or have explicit
            permission to reproduce.
          </p>
        ) : (
          <p>
            Heads up — you haven&apos;t linked an X account to your
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
 * Tighter version of ``AuthorshipWarning`` shown *before* import, on
 * the empty banner, when the analyst has no linked X handle. The
 * post-import warning is more informative when the mismatch is real;
 * this one nudges the analyst to link their handle (or accept they
 * won't get the friction-removing match check on their own work).
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
        </a>{" "}
        — we&apos;ll flag a heads-up on import to make sure you have
        permission to publish the tweet.
      </span>
    </div>
  );
}
