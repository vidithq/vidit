"use client";

import { useState } from "react";
import { AtSign, Bot, Ellipsis, EyeOff, RotateCcw, Trash2 } from "lucide-react";

import {
  deleteUser,
  purgeDetectedEvents,
  restoreUser,
  setUserInviteMinting,
  setUserXHandle,
  type AdminUser,
} from "@/lib/admin";
import { formatInstant } from "@/lib/format";
import { useMutation } from "@/hooks/useMutation";
import type { UserOutcome } from "@/components/admin/ActionReceipt";
import { FORM_LABEL, LIST_TILE } from "@/components/ui/form-styles";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Pill";
import { ToggleRow } from "@/components/ui/ToggleRow";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

/** The fields the action card needs; `AdminUser` minus the list-only
 *  `created_at`, so the invite-list redeemer converts without inventing one. `deleted_at` is set
 *  on a soft-deleted account, which only the invite list reaches. */
type ActionableUser = Omit<AdminUser, "created_at"> & { deleted_at?: string | null };

type DangerMode = "soft" | "hard" | "purge" | "restore";

const DANGER_LABELS: Record<DangerMode, string> = {
  soft: "Soft delete",
  hard: "Hard delete",
  purge: "Purge detected",
  restore: "Restore",
};

/** One user's admin actions: X-handle link, invite minting switch, soft/hard delete, detections
 * purge. The link and the destructive actions sit in the card's action menu, and each destructive
 * one opens a `ConfirmDialog`. A soft-deleted account says so and offers only Restore and Hard
 * delete. Shared by Manage-analysts search and the onboarding table. */
export function UserActionsCard({
  user,
  detectedCount,
  onUpdated,
  onOutcome,
}: {
  user: ActionableUser;
  /** Live detections, shown on the purge item when known. */
  detectedCount?: number;
  onUpdated: (u: AdminUser) => void;
  onOutcome: (outcome: UserOutcome) => void;
}) {
  const [xHandle, setXHandle] = useState(user.x_handle ?? "");
  const [showXHandleForm, setShowXHandleForm] = useState(false);
  const [dangerMode, setDangerMode] = useState<DangerMode | null>(null);
  const [mintingEnabled, setMintingEnabled] = useState(user.is_invite_minting_enabled);

  const xHandleMutation = useMutation(
    (value: string | null) => setUserXHandle(user.id, { x_handle: value }),
    {
      fallback: "Failed to update the X handle",
      onSuccess: (updated) => {
        onUpdated(updated);
        setXHandle(updated.x_handle ?? "");
        setShowXHandleForm(false);
      },
    },
  );

  const mintingMutation = useMutation(
    (enabled: boolean) => setUserInviteMinting(user.id, enabled),
    {
      fallback: "Failed to change invite minting",
      onSuccess: (updated) => {
        setMintingEnabled(updated.is_invite_minting_enabled);
        onUpdated(updated);
      },
    },
  );

  const finish = (outcome: UserOutcome) => {
    setDangerMode(null);
    onOutcome(outcome);
  };

  const deleteMutation = useMutation(
    (hard: boolean) => deleteUser(user.id, { hard }),
    {
      fallback: "Failed to delete user",
      onSuccess: (data) => finish({ kind: "delete", data }),
    },
  );

  const purgeMutation = useMutation(() => purgeDetectedEvents(user.id), {
    fallback: "Failed to purge detections",
    onSuccess: (data) => finish({ kind: "purge", data }),
  });

  const restoreMutation = useMutation(() => restoreUser(user.id), {
    fallback: "Failed to restore the account",
    onSuccess: (data) => finish({ kind: "restore", data }),
  });

  const deleted = Boolean(user.deleted_at);
  const linking = xHandleMutation.loading;
  const acting = deleteMutation.loading || purgeMutation.loading || restoreMutation.loading;
  // The card's error slot serves the inline actions; a destructive action's refusal shows in its
  // dialog.
  const error = xHandleMutation.error ?? mintingMutation.error;
  const dangerError = deleteMutation.error ?? purgeMutation.error ?? restoreMutation.error;

  const resetAll = () => {
    xHandleMutation.reset();
    mintingMutation.reset();
    deleteMutation.reset();
    purgeMutation.reset();
    restoreMutation.reset();
  };

  const submitXHandle = () => {
    resetAll();
    if (!xHandle.trim()) {
      xHandleMutation.setError(
        "An X handle is required (use Clear to unlink).",
      );
      return;
    }
    void xHandleMutation.run(xHandle.trim());
  };

  const submitXHandleClear = () => {
    resetAll();
    void xHandleMutation.run(null);
  };

  const submitDanger = () => {
    if (dangerMode === "purge") {
      void purgeMutation.run();
    } else if (dangerMode === "restore") {
      void restoreMutation.run();
    } else if (dangerMode !== null) {
      void deleteMutation.run(dangerMode === "hard");
    }
  };

  const openDanger = (mode: DangerMode) => {
    resetAll();
    setDangerMode(mode);
  };

  const cancelDanger = () => {
    setDangerMode(null);
    deleteMutation.reset();
    purgeMutation.reset();
    restoreMutation.reset();
  };

  return (
    <div className={`${LIST_TILE} space-y-2`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-neutral-100 inline-flex items-center gap-1.5">
            {user.username}
            {user.is_admin && (
              <Pill className="uppercase tracking-wider">admin</Pill>
            )}
            {user.deleted_at && (
              <Pill tone="danger">Soft-deleted {formatInstant(user.deleted_at)}</Pill>
            )}
          </div>
          {user.email && (
            <div className="text-xs text-neutral-500 truncate">
              {user.email}
            </div>
          )}
          {user.x_handle && (
            <div className="mt-1">
              <Pill>X: @{user.x_handle}</Pill>
            </div>
          )}
          {user.sponsor && (
            <div className="text-xs text-neutral-500 mt-1">
              Invited by {user.sponsor.username}
            </div>
          )}
        </div>
        <ActionMenu
          label={`Actions for ${user.username}`}
          icon={<Ellipsis size={14} />}
          items={[
            ...(deleted
              ? [
                  {
                    key: "restore",
                    label: DANGER_LABELS.restore,
                    icon: <RotateCcw size={14} aria-hidden />,
                    onSelect: () => openDanger("restore"),
                  },
                ]
              : [
                  {
                    key: "x-handle",
                    label: user.x_handle ? "Edit X handle" : "Link X handle",
                    icon: <AtSign size={14} aria-hidden />,
                    onSelect: () => {
                      resetAll();
                      setShowXHandleForm(true);
                    },
                  },
                  {
                    key: "purge",
                    label: `${DANGER_LABELS.purge}${detectedCount !== undefined ? ` (${detectedCount})` : ""}`,
                    icon: <Bot size={14} aria-hidden />,
                    onSelect: () => openDanger("purge"),
                  },
                  {
                    key: "soft",
                    label: DANGER_LABELS.soft,
                    icon: <EyeOff size={14} aria-hidden />,
                    onSelect: () => openDanger("soft"),
                  },
                ]),
            {
              key: "hard",
              label: DANGER_LABELS.hard,
              icon: <Trash2 size={14} aria-hidden />,
              onSelect: () => openDanger("hard"),
            },
          ]}
        />
      </div>

      {!deleted && (
        <ToggleRow
          label="Can mint invite codes"
          description="Lets this analyst invite others from Settings, up to the daily quota. Codes already minted stay valid."
          on={mintingEnabled}
          onToggle={() => {
            if (mintingMutation.loading) return;
            resetAll();
            void mintingMutation.run(!mintingEnabled);
          }}
        />
      )}

      {showXHandleForm && (
        <div className="space-y-2">
          <label className={FORM_LABEL} htmlFor={`x-handle-${user.id}`}>
            X handle (the bot attributes mentions from this handle to this
            account)
          </label>
          <Input
            variant="compact"
            id={`x-handle-${user.id}`}
            type="text"
            value={xHandle}
            onChange={(e) => setXHandle(e.target.value)}
            placeholder="e.g. @osint_hawk"
          />
          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={submitXHandle}
              disabled={linking}
            >
              {linking ? "Saving…" : "Confirm link"}
            </Button>
            {user.x_handle && (
              <Button
                variant="danger"
                onClick={submitXHandleClear}
                disabled={linking}
              >
                Clear link
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => {
                setShowXHandleForm(false);
                setXHandle(user.x_handle ?? "");
                xHandleMutation.reset();
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && <ErrorNotice error={error} />}

      {dangerMode !== null && (
        <ConfirmDialog
          title={
            dangerMode === "purge"
              ? `Purge the detections of ${user.username}?`
              : `${DANGER_LABELS[dangerMode]} ${user.username}?`
          }
          confirmLabel={DANGER_LABELS[dangerMode]}
          busyLabel="Working…"
          busy={acting}
          error={dangerError}
          tone={dangerMode === "restore" ? "accent" : "danger"}
          onConfirm={submitDanger}
          onCancel={cancelDanger}
        >
          {dangerMode === "hard" ? (
            <p>
              <strong>Hard delete is irreversible.</strong> Drops{" "}
              {user.username}, every geolocation they authored, their media, and
              S3 objects. A geolocation another analyst shares the credit of passes
              to that analyst instead, with its media.
            </p>
          ) : dangerMode === "soft" ? (
            <p>
              Soft-deleting hides {user.username} from public reads and
              cascade-hides every geolocation they authored.
            </p>
          ) : dangerMode === "restore" ? (
            <p>
              Restoring lets {user.username} sign in again and brings back the
              events the soft delete hid. The X handle it released stays
              unlinked.
            </p>
          ) : (
            <p>
              Purging drops every <strong>detection</strong>{" "}
              {user.username} owns (rows + media, dismissed detections included, so
              the sweep can exceed the counter), and keeps the account, its
              geolocations and its requests. The broken-archive repair.
            </p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
