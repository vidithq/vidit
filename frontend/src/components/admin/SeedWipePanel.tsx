"use client";

import { useState, type ReactNode } from "react";

import { useConfirmAction } from "@/hooks/useConfirmAction";
import { useMutation } from "@/hooks/useMutation";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
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
  const [lastSeed, setLastSeed] = useState<S | null>(null);
  const [lastWipe, setLastWipe] = useState<W | null>(null);

  const seedMutation = useMutation((c: number) => seed(c), {
    fallback: "Failed to seed",
    onSuccess: setLastSeed,
  });
  const wipeMutation = useMutation(wipe, {
    fallback: "Failed to wipe",
    onSuccess: setLastWipe,
  });

  const confirmWipe = useConfirmAction(
    () => {
      seedMutation.reset();
      void wipeMutation.run();
    },
    { timeoutMs: 3000 }
  );

  const seeding = seedMutation.loading;
  const wiping = wipeMutation.loading;
  // One shared error slot, cleared whenever the other action fires (mirrors
  // the old single `setError(null)` at the top of each handler).
  const error = seedMutation.error ?? wipeMutation.error;

  const onSeed = () => {
    wipeMutation.reset();
    void seedMutation.run(count);
  };

  return (
    <section className="border border-neutral-800 rounded-lg bg-neutral-900/50">
      <header className="px-4 py-3 border-b border-neutral-800">
        <SectionEyebrow title={title} margin="none" />
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
            onClick={confirmWipe.trigger}
            disabled={wiping}
            className={`px-3 py-1.5 rounded-md text-sm border transition-colors disabled:opacity-50 ${
              confirmWipe.armed
                ? "border-red-500 bg-red-500/30 text-red-200"
                : "border-red-500/40 bg-red-500/15 text-red-300 hover:bg-red-500/25"
            }`}
          >
            {wiping
              ? "Wiping…"
              : confirmWipe.armed
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
