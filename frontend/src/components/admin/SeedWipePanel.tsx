"use client";

import { useState, type ReactNode } from "react";

import { useConfirmAction } from "@/hooks/useConfirmAction";
import { useMutation } from "@/hooks/useMutation";
import { DevToolPanel } from "@/components/admin/DevToolPanel";
import { FORM_LABEL } from "@/components/ui/form-styles";
import { Button, DANGER_CONFIRM } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

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
    <DevToolPanel title={title} description={description}>
        <div className="flex items-end gap-3">
          <div className="flex-1 max-w-[180px]">
            <label className={FORM_LABEL} htmlFor={countInputId}>
              Count
            </label>
            <Input
              variant="compact"
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
            />
          </div>
          <Button variant="primary" onClick={onSeed} disabled={seeding}>
            {seeding ? "Generating…" : seedLabel}
          </Button>
          <Button
            variant="danger"
            onClick={confirmWipe.trigger}
            disabled={wiping}
            className={confirmWipe.armed ? DANGER_CONFIRM : ""}
          >
            {wiping
              ? "Wiping…"
              : confirmWipe.armed
                ? "Click again to confirm"
                : wipeLabel}
          </Button>
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
    </DevToolPanel>
  );
}
