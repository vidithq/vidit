"use client";

import { useState } from "react";

import {
  deleteUser,
  purgeDetectedEvents,
  setUserXHandle,
  type AdminPurgeDetectedResponse,
  type AdminUser,
  type AdminUserDeleteResponse,
} from "@/lib/admin";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { useMutation } from "@/hooks/useMutation";
import { FORM_LABEL } from "@/components/ui/form-styles";
import { WARNING_CALLOUT } from "@/components/ui/styles";
import { Button, DANGER_CONFIRM } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Pill";

/** The fields the action card needs; `AdminUser` minus the list-only
 *  `created_at`, so the invite-list redeemer converts without inventing one. */
type ActionableUser = Omit<AdminUser, "created_at">;

type DangerMode = "soft" | "hard" | "purge";

/** One user's admin actions: X-handle link, soft/hard delete, and the
 *  detections purge. Shared between the Manage-analysts search and the
 *  onboarding table so the two never drift. */
export function UserActionsCard({
  user,
  detectedCount,
  onUpdated,
  onDeleted,
  onPurged,
}: {
  user: ActionableUser;
  /** Live detections, shown on the purge button when known. */
  detectedCount?: number;
  onUpdated: (u: AdminUser) => void;
  onDeleted: (userId: string, response: AdminUserDeleteResponse) => void;
  onPurged?: (response: AdminPurgeDetectedResponse) => void;
}) {
  const [xHandle, setXHandle] = useState(user.x_handle ?? "");
  const [showXHandleForm, setShowXHandleForm] = useState(false);
  const [dangerMode, setDangerMode] = useState<DangerMode | null>(null);

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

  const deleteMutation = useMutation(
    (hard: boolean) => deleteUser(user.id, { hard }),
    {
      fallback: "Failed to delete user",
      onSuccess: (response) => {
        onDeleted(user.id, response);
        setDangerMode(null);
        confirmDanger.cancel();
      },
    },
  );

  const purgeMutation = useMutation(() => purgeDetectedEvents(user.id), {
    fallback: "Failed to purge detections",
    onSuccess: (response) => {
      onPurged?.(response);
      setDangerMode(null);
      confirmDanger.cancel();
    },
  });

  const linking = xHandleMutation.loading;
  const acting = deleteMutation.loading || purgeMutation.loading;
  // One shared error slot across the card's actions; each action clears
  // the others.
  const error =
    xHandleMutation.error ?? deleteMutation.error ?? purgeMutation.error;

  const resetOthers = (keep: "xhandle" | "danger") => {
    if (keep !== "xhandle") xHandleMutation.reset();
    if (keep !== "danger") {
      deleteMutation.reset();
      purgeMutation.reset();
    }
  };

  const submitXHandle = () => {
    resetOthers("xhandle");
    if (!xHandle.trim()) {
      xHandleMutation.setError(
        "An X handle is required (use Clear to unlink).",
      );
      return;
    }
    void xHandleMutation.run(xHandle.trim());
  };

  const submitXHandleClear = () => {
    resetOthers("xhandle");
    void xHandleMutation.run(null);
  };

  const submitDanger = () => {
    if (dangerMode === null) return;
    resetOthers("danger");
    if (dangerMode === "purge") {
      void purgeMutation.run();
    } else {
      void deleteMutation.run(dangerMode === "hard");
    }
  };

  const confirmDanger = useConfirmAction(() => submitDanger());

  const armDanger = (mode: DangerMode) => {
    setDangerMode(mode);
    confirmDanger.cancel();
  };

  const cancelDanger = () => {
    setDangerMode(null);
    confirmDanger.cancel();
    xHandleMutation.reset();
    deleteMutation.reset();
    purgeMutation.reset();
  };

  const idle = dangerMode === null && !showXHandleForm;

  return (
    <div className="border border-neutral-800 rounded-md p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-neutral-100 inline-flex items-center gap-1.5">
            @{user.username}
            {user.is_admin && (
              <Pill className="uppercase tracking-wider">admin</Pill>
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
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          {idle && (
            <Button
              variant="ghost"
              onClick={() => setShowXHandleForm(true)}
              className="whitespace-nowrap"
            >
              {user.x_handle ? "Edit X handle" : "Link X handle"}
            </Button>
          )}
          {idle && (
            <Button
              variant="ghost"
              onClick={() => armDanger("purge")}
              className="whitespace-nowrap"
            >
              Purge detected
              {detectedCount !== undefined ? ` (${detectedCount})` : ""}
            </Button>
          )}
          {idle && (
            <div className="inline-flex gap-1">
              <Button
                variant="ghost"
                onClick={() => armDanger("soft")}
                className="whitespace-nowrap"
              >
                Soft delete
              </Button>
              <Button
                variant="danger"
                onClick={() => armDanger("hard")}
                className="whitespace-nowrap"
              >
                Hard delete
              </Button>
            </div>
          )}
        </div>
      </div>

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
                deleteMutation.reset();
                purgeMutation.reset();
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {dangerMode !== null && (
        <div
          className={`px-3 py-2 rounded-md text-xs space-y-2 ${
            dangerMode === "hard"
              ? "border bg-red-500/5 border-red-500/30 text-red-200"
              : WARNING_CALLOUT
          }`}
        >
          {dangerMode === "hard" ? (
            <p>
              <strong>Hard delete is irreversible.</strong> Drops @
              {user.username}, every geolocation they authored, their media, and
              S3 objects.{" "}
              {!confirmDanger.armed && "Click “Confirm” to proceed."}
            </p>
          ) : dangerMode === "soft" ? (
            <p>
              Soft-deleting will hide @{user.username} from public reads and
              cascade-hide every geolocation they authored.{" "}
              {!confirmDanger.armed && "Click “Confirm” to proceed."}
            </p>
          ) : (
            <p>
              Purging drops every <strong>detection</strong> @
              {user.username} owns (rows + media, dismissed detections included, so
              the sweep can exceed the counter), and keeps the account, its
              geolocations and its requests. The broken-archive repair.{" "}
              {!confirmDanger.armed && "Click “Confirm” to proceed."}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              variant="danger"
              onClick={confirmDanger.trigger}
              disabled={acting}
              className={confirmDanger.armed ? DANGER_CONFIRM : ""}
            >
              {acting
                ? "Working…"
                : confirmDanger.armed
                  ? "Confirm"
                  : dangerMode === "hard"
                    ? "Hard delete"
                    : dangerMode === "soft"
                      ? "Soft delete"
                      : "Purge detected"}
            </Button>
            <Button variant="ghost" onClick={cancelDanger}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && <div className="text-xs text-red-300">{error}</div>}
    </div>
  );
}
