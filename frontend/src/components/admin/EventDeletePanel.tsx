"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";

import {
  deleteEvent,
  type AdminEventDeleteResponse,
} from "@/lib/admin";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { useMutation } from "@/hooks/useMutation";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import {
  FORM_ERROR_BANNER,
  FORM_LABEL,
} from "@/components/ui/form-styles";
import { WARNING_CALLOUT } from "@/components/ui/styles";
import { Button, DANGER_CONFIRM } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { ActionReceipt } from "@/components/admin/ActionReceipt";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

export function EventDeletePanel() {
  const [id, setId] = useState("");
  const [mode, setMode] = useState<"soft" | "hard">("soft");
  const [result, setResult] = useState<AdminEventDeleteResponse | null>(
    null
  );

  const reset = () => {
    confirm.cancel();
    setId("");
    setMode("soft");
  };

  const deleteMutation = useMutation(
    () => deleteEvent(id.trim(), { hard: mode === "hard" }),
    {
      fallback: "Delete failed",
      onSuccess: (response) => {
        setResult(response);
        reset();
      },
    }
  );
  const confirm = useConfirmAction(() => {
    void deleteMutation.run();
  });
  const { error, setError } = deleteMutation;
  const submitting = deleteMutation.loading;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim()) return;
    if (!confirm.armed) setError(null);
    confirm.trigger();
  };

  return (
    <Card as="section">
      <header>
        <SectionEyebrow title="Remove a geolocation" margin="none" />
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
          <Input
            variant="compact"
            id="geo-id"
            type="text"
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              confirm.cancel();
            }}
            placeholder="00000000-0000-0000-0000-000000000000"
            className="mt-1 font-mono"
          />
        </div>

        <div>
          <span className={FORM_LABEL}>Mode</span>
          <SegmentedControl
            aria-label="Delete mode"
            fullWidth
            options={[
              { value: "soft", label: "Soft delete (default)" },
              { value: "hard", label: "Hard delete (GDPR)", tone: "danger" },
            ]}
            value={mode}
            onChange={(m) => {
              setMode(m);
              confirm.cancel();
            }}
          />
        </div>

        {error && (
          <div className={FORM_ERROR_BANNER}>
            {error}
          </div>
        )}

        {confirm.armed && (
          <div className={`px-3 py-2 rounded-md text-xs ${WARNING_CALLOUT}`}>
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
          <Button
            type="submit"
            variant="danger"
            disabled={submitting || !id.trim()}
            className={confirm.armed ? DANGER_CONFIRM : ""}
          >
            {submitting
              ? "Deleting…"
              : confirm.armed
                ? "Confirm"
                : mode === "hard"
                  ? "Hard delete"
                  : "Soft delete"}
          </Button>
          {confirm.armed && (
            <Button variant="ghost" onClick={() => confirm.cancel()}>
              Cancel
            </Button>
          )}
        </div>
      </form>

      {result && (
        <ActionReceipt
          mode={result.mode}
          header={
            <>
              <MapPin size={12} className="text-orange-400" />
              <span className="font-medium">{result.title}</span>
            </>
          }
        >
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
        </ActionReceipt>
      )}
    </Card>
  );
}
