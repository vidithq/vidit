"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";

import {
  deleteGeolocation,
  type AdminGeolocationDeleteResponse,
} from "@/lib/admin";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import {
  FORM_INPUT_COMPACT,
  FORM_LABEL,
} from "@/components/ui/form-styles";

export function GeolocationDeletePanel() {
  const [id, setId] = useState("");
  const [mode, setMode] = useState<"soft" | "hard">("soft");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AdminGeolocationDeleteResponse | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setConfirming(false);
    setId("");
    setMode("soft");
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim()) return;
    if (!confirming) {
      setConfirming(true);
      setError(null);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await deleteGeolocation(id.trim(), {
        hard: mode === "hard",
      });
      setResult(response);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-4">
      <header>
        <h2 className="text-sm font-medium text-neutral-100">
          Remove a geolocation
        </h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          Soft delete hides the row from every public read but preserves the
          proof + S3 evidence — that&apos;s the default. Hard delete is the
          GDPR escape hatch: drops the row, the media rows, and the S3
          objects. Audited either way.
        </p>
      </header>

      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label className={FORM_LABEL} htmlFor="geo-id">
            Geolocation ID (UUID)
          </label>
          <input
            id="geo-id"
            type="text"
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              setConfirming(false);
            }}
            placeholder="00000000-0000-0000-0000-000000000000"
            className={`mt-1 ${FORM_INPUT_COMPACT} font-mono`}
          />
        </div>

        <fieldset className="flex gap-2">
          <legend className={FORM_LABEL}>Mode</legend>
          {(["soft", "hard"] as const).map((m) => (
            <label
              key={m}
              className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-xs cursor-pointer border ${
                mode === m
                  ? m === "hard"
                    ? "bg-red-500/10 border-red-500/40 text-red-300"
                    : "bg-orange-500/15 border-orange-500/30 text-orange-300"
                  : "bg-neutral-800 border-neutral-700 text-neutral-400 hover:text-neutral-200"
              }`}
            >
              <input
                type="radio"
                name="delete-mode"
                value={m}
                checked={mode === m}
                onChange={() => {
                  setMode(m);
                  setConfirming(false);
                }}
                className="sr-only"
              />
              {m === "soft" ? "Soft delete (default)" : "Hard delete (GDPR)"}
            </label>
          ))}
        </fieldset>

        {error && (
          <div className="px-3 py-2 rounded-md text-xs text-red-300 bg-red-500/10 border border-red-500/30">
            {error}
          </div>
        )}

        {confirming && (
          <div className="px-3 py-2 rounded-md text-xs text-amber-300 bg-amber-500/5 border border-amber-500/30">
            {mode === "hard" ? (
              <>
                <strong>Hard delete is irreversible.</strong> The row, its
                media, and its S3 objects will be erased. Click
                &ldquo;Confirm&rdquo; again to proceed.
              </>
            ) : (
              <>
                The geolocation will be removed from public view. Click
                &ldquo;Confirm&rdquo; again to proceed.
              </>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting || !id.trim()}
            className={`px-3 py-1.5 rounded-md text-xs font-medium disabled:opacity-50 ${
              mode === "hard"
                ? "bg-red-500 hover:bg-red-400 text-white transition-colors"
                : PRIMARY_BUTTON
            }`}
          >
            {submitting
              ? "Deleting…"
              : confirming
                ? "Confirm"
                : mode === "hard"
                  ? "Hard delete"
                  : "Soft delete"}
          </button>
          {confirming && (
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="px-3 py-1.5 rounded-md text-xs text-neutral-400 hover:text-neutral-200"
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      {result && (
        <div className="px-3 py-2 rounded-md text-xs text-neutral-300 bg-neutral-800/60 border border-neutral-700 space-y-1">
          <div className="inline-flex items-center gap-1.5">
            <MapPin size={12} className="text-orange-400" />
            <span className="font-medium">{result.title}</span>
            <span
              className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                result.mode === "hard"
                  ? "border-red-500/30 text-red-300"
                  : "border-orange-500/30 text-orange-300"
              }`}
            >
              {result.mode}
            </span>
          </div>
          <div className="text-neutral-500 font-mono text-[11px]">
            {result.geolocation_id}
          </div>
          {result.mode === "hard" && (
            <div className="text-neutral-500">
              Swept {result.media_count} media row
              {result.media_count === 1 ? "" : "s"} +{" "}
              {result.proof_image_count} proof image
              {result.proof_image_count === 1 ? "" : "s"}.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
