"use client";

import { useState, type ReactNode } from "react";

import { PRIMARY_BUTTON } from "@/components/ui/styles";
import {
  FORM_INPUT_COMPACT,
  FORM_LABEL,
} from "@/components/ui/form-styles";

interface SeedWipePanelProps<S, W> {
  title: string;
  description: ReactNode;
  countInputId: string;
  defaultCount: number;
  maxCount: number;
  seed: (count: number) => Promise<S>;
  seedLabel: string;
  wipe: () => Promise<W>;
  wipeLabel: string;
  renderSeedSummary: (last: S) => ReactNode;
  renderWipeSummary: (last: W) => ReactNode;
}

/**
 * Shared seed/wipe panel. The wipe button is guarded by a click-twice
 * confirm that auto-expires after 3s.
 */
export function SeedWipePanel<S, W>({
  title,
  description,
  countInputId,
  defaultCount,
  maxCount,
  seed,
  seedLabel,
  wipe,
  wipeLabel,
  renderSeedSummary,
  renderWipeSummary,
}: SeedWipePanelProps<S, W>) {
  const [count, setCount] = useState(defaultCount);
  const [seeding, setSeeding] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [lastSeed, setLastSeed] = useState<S | null>(null);
  const [lastWipe, setLastWipe] = useState<W | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSeed = async () => {
    setError(null);
    setSeeding(true);
    try {
      setLastSeed(await seed(count));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to seed");
    } finally {
      setSeeding(false);
    }
  };

  const onWipe = async () => {
    if (!confirmWipe) {
      setConfirmWipe(true);
      window.setTimeout(() => setConfirmWipe(false), 3000);
      return;
    }
    setError(null);
    setWiping(true);
    setConfirmWipe(false);
    try {
      setLastWipe(await wipe());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to wipe");
    } finally {
      setWiping(false);
    }
  };

  return (
    <section className="border border-neutral-800 rounded-lg bg-neutral-900/50">
      <header className="px-4 py-3 border-b border-neutral-800">
        <h2 className="text-sm font-medium text-neutral-200">{title}</h2>
        <p className="text-xs text-neutral-500 mt-0.5">{description}</p>
      </header>
      <div className="px-4 py-3 space-y-3">
        <div className="flex items-end gap-3">
          <div className="flex-1 max-w-[180px]">
            <label className={FORM_LABEL} htmlFor={countInputId}>
              Count
            </label>
            <input
              id={countInputId}
              type="number"
              min={1}
              max={maxCount}
              value={count}
              onChange={(e) =>
                setCount(
                  Math.max(1, Math.min(maxCount, Number(e.target.value) || 1))
                )
              }
              className={FORM_INPUT_COMPACT}
            />
          </div>
          <button
            type="button"
            onClick={onSeed}
            disabled={seeding}
            className={`px-3 py-1.5 rounded-md text-sm disabled:opacity-50 ${PRIMARY_BUTTON}`}
          >
            {seeding ? "Generating…" : seedLabel}
          </button>
          <button
            type="button"
            onClick={onWipe}
            disabled={wiping}
            className={`px-3 py-1.5 rounded-md text-sm border transition-colors disabled:opacity-50 ${
              confirmWipe
                ? "border-red-500 bg-red-500/30 text-red-200"
                : "border-red-500/40 bg-red-500/15 text-red-300 hover:bg-red-500/25"
            }`}
          >
            {wiping
              ? "Wiping…"
              : confirmWipe
                ? "Click again to confirm"
                : wipeLabel}
          </button>
        </div>

        {lastSeed !== null && (
          <p className="text-xs text-neutral-400">
            {renderSeedSummary(lastSeed)}
          </p>
        )}
        {lastWipe !== null && (
          <p className="text-xs text-neutral-400">
            {renderWipeSummary(lastWipe)}
          </p>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </section>
  );
}
