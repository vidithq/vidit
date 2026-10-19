"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";

import {
  deleteEvent,
  setEventModeration,
  type AdminEventDeleteResponse,
  type AdminEventModeration,
} from "@/lib/admin";
import { countLabel, formatInstant } from "@/lib/format";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { useMutation } from "@/hooks/useMutation";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER, FORM_LABEL } from "@/components/ui/form-styles";
import { WARNING_CALLOUT } from "@/components/ui/styles";
import { Button, DANGER_CONFIRM } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ActionReceipt } from "@/components/admin/ActionReceipt";

/**
 * Every admin action on one event by id, with no report behind it: the two moderation axes
 * (`PATCH /admin/events/{id}/moderation`, the one verb that undoes a takedown) and the soft or
 * hard delete (`DELETE /admin/events/{id}`). Hide and delete take the two-click confirm.
 */

type ModerationBody = { is_graphic?: boolean; hidden?: boolean };

const MODERATION_ACTIONS = [
  { key: "mark", label: "Mark graphic", body: { is_graphic: true } },
  { key: "unmark", label: "Unmark graphic", body: { is_graphic: false } },
  { key: "unhide", label: "Restore", body: { hidden: false } },
] as const;

type Receipt =
  | { kind: "moderation"; data: AdminEventModeration }
  | { kind: "delete"; data: AdminEventDeleteResponse };

export function EventActionsPanel() {
  const [id, setId] = useState("");
  const [mode, setMode] = useState<"soft" | "hard">("soft");
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const moderateMutation = useMutation(
    (body: ModerationBody) => setEventModeration(id.trim(), body),
    {
      fallback: "Moderation failed",
      onSuccess: (data) => setReceipt({ kind: "moderation", data }),
    }
  );
  const deleteMutation = useMutation(
    () => deleteEvent(id.trim(), { hard: mode === "hard" }),
    {
      fallback: "Delete failed",
      onSuccess: (data) => {
        setReceipt({ kind: "delete", data });
        setId("");
        setMode("soft");
      },
    }
  );

  const moderate = (body: ModerationBody) => {
    deleteMutation.reset();
    void moderateMutation.run(body);
  };
  const confirmHide = useConfirmAction(() => moderate({ hidden: true }));
  const confirmDelete = useConfirmAction(() => {
    moderateMutation.reset();
    void deleteMutation.run();
  });

  const cancelAll = () => {
    confirmHide.cancel();
    confirmDelete.cancel();
  };

  const busy = moderateMutation.loading || deleteMutation.loading;
  const disabled = busy || !id.trim();
  const error = moderateMutation.error ?? deleteMutation.error;

  return (
    <Card as="section">
      <header>
        <SectionEyebrow title="Manage an event" margin="none" />
        <p className="text-xs text-neutral-500 mt-0.5">
          Act on one event by its ID, with no report behind it. Graphic blurs
          the media behind an age confirmation. Hide withholds the event from
          every public read, and Restore undoes a hide. Soft delete removes the
          event from public view and keeps its proof and S3 evidence. Hard
          delete erases the row, its media rows and its S3 objects (the GDPR
          path). Every action is audited.
        </p>
      </header>

      <div>
        <label className={FORM_LABEL} htmlFor="event-actions-id">
          Event ID (UUID)
        </label>
        <Input
          variant="compact"
          id="event-actions-id"
          type="text"
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            cancelAll();
          }}
          placeholder="00000000-0000-0000-0000-000000000000"
          className="mt-1 font-mono"
        />
      </div>

      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}

      <div className="space-y-2">
        <span className={FORM_LABEL}>Moderation</span>
        {confirmHide.armed && (
          <div className={`px-3 py-2 rounded-md text-xs ${WARNING_CALLOUT}`}>
            The event drops off every public read until it is restored. Click
            &ldquo;Confirm&rdquo; again to proceed.
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {MODERATION_ACTIONS.map((action) => (
            <Button
              key={action.key}
              variant="secondary"
              disabled={disabled}
              onClick={() => {
                cancelAll();
                moderate(action.body);
              }}
            >
              {action.label}
            </Button>
          ))}
          <Button
            variant="danger"
            disabled={disabled}
            className={confirmHide.armed ? DANGER_CONFIRM : ""}
            onClick={() => {
              confirmDelete.cancel();
              confirmHide.trigger();
            }}
          >
            {confirmHide.armed ? "Confirm" : "Hide"}
          </Button>
          {confirmHide.armed && (
            <Button variant="ghost" onClick={() => confirmHide.cancel()}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <span className={FORM_LABEL}>Delete</span>
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
            confirmDelete.cancel();
          }}
        />
        {confirmDelete.armed && (
          <div className={`px-3 py-2 rounded-md text-xs ${WARNING_CALLOUT}`}>
            {mode === "hard" ? (
              <>
                <strong>Hard delete is irreversible.</strong> The row, its
                media, and its S3 objects will be erased. Click
                &ldquo;Confirm&rdquo; again to proceed.
              </>
            ) : (
              <>
                The event will be removed from public view. Click
                &ldquo;Confirm&rdquo; again to proceed.
              </>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <Button
            variant="danger"
            disabled={disabled}
            className={confirmDelete.armed ? DANGER_CONFIRM : ""}
            onClick={() => {
              confirmHide.cancel();
              confirmDelete.trigger();
            }}
          >
            {deleteMutation.loading
              ? "Deleting…"
              : confirmDelete.armed
                ? "Confirm"
                : mode === "hard"
                  ? "Hard delete"
                  : "Soft delete"}
          </Button>
          {confirmDelete.armed && (
            <Button variant="ghost" onClick={() => confirmDelete.cancel()}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      {receipt?.kind === "moderation" && (
        <ActionReceipt
          // `hidden_at` is the takedown: a withheld row reads as hard, a live one as soft.
          mode={receipt.data.hidden_at ? "hard" : "soft"}
          header={
            <>
              <MapPin size={12} className="text-orange-400" />
              <span className="font-medium">
                {receipt.data.is_graphic ? "Graphic" : "Not graphic"}
              </span>
            </>
          }
        >
          <div className="text-neutral-500 font-mono text-[11px]">
            {receipt.data.id}
          </div>
          <div className="text-neutral-500">
            {receipt.data.hidden_at
              ? `Hidden since ${formatInstant(receipt.data.hidden_at)}.`
              : "Visible on every public read."}
          </div>
        </ActionReceipt>
      )}

      {receipt?.kind === "delete" && (
        <ActionReceipt
          mode={receipt.data.mode}
          header={
            <>
              <MapPin size={12} className="text-orange-400" />
              <span className="font-medium">{receipt.data.title}</span>
            </>
          }
        >
          <div className="text-neutral-500 font-mono text-[11px]">
            {receipt.data.geolocation_id}
          </div>
          {receipt.data.mode === "hard" && (
            <div className="text-neutral-500">
              Swept {countLabel(receipt.data.media_count, "media row")} (source and proof roles).
            </div>
          )}
        </ActionReceipt>
      )}
    </Card>
  );
}
