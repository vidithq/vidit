"use client";

import { useState } from "react";

import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import { formatDate } from "@/lib/format";
import {
  MY_X_HANDLE_PATH,
  X_HANDLE_REASON_MAX_LEN,
  requestXHandleChange,
  type XHandleState,
} from "@/lib/xHandle";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Pill";
import { FORM_ERROR_BANNER, FORM_LABEL } from "@/components/ui/form-styles";

/** The Account card's X handle row: the bound handle, read-only, the analyst's change
 *  request if any, and the form that files one. Only an admin writes the handle. */
export function AccountXHandle() {
  const { data, error } = useApiResource<XHandleState>(MY_X_HANDLE_PATH);
  const [saved, setSaved] = useState<XHandleState | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [handle, setHandle] = useState("");
  const [reason, setReason] = useState("");

  const submit = useMutation(
    () =>
      requestXHandleChange({ x_handle: handle.trim(), reason: reason.trim() || null }),
    {
      fallback: "Could not send the request. Try again.",
      onSuccess: (state) => {
        setSaved(state);
        setFormOpen(false);
        setHandle("");
        setReason("");
      },
    }
  );

  const state = saved ?? data;
  const bound = state?.x_handle ?? null;
  const request = state?.request ?? null;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submit.run();
  };

  const closeForm = () => {
    setFormOpen(false);
    submit.reset();
  };

  return (
    <div className="space-y-3 border-t border-neutral-800 pt-4 text-sm">
      <div>
        <span className={FORM_LABEL}>X handle</span>
        <p className={`mt-0.5 ${bound ? "text-neutral-100" : "text-neutral-500"}`}>
          {bound ? `@${bound}` : "No X handle linked"}
        </p>
        <p className="text-xs text-neutral-500 mt-1">
          The Vidit bot and the archive import credit posts from this handle to your
          account. An admin links it and changes it on request.
        </p>
      </div>

      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}

      {request && (
        <p className="text-xs text-neutral-400 flex flex-wrap items-center gap-1.5">
          {request.status === "pending" ? (
            <>
              <Pill tone="accent">Pending</Pill>
              You asked for @{request.x_handle} on {formatDate(request.created_at)}.
            </>
          ) : (
            <>
              <Pill tone="danger">Declined</Pill>
              <span className="wrap-anywhere">
                Your request for @{request.x_handle} was declined: {request.decline_reason}
              </span>
            </>
          )}
        </p>
      )}

      {formOpen ? (
        <form onSubmit={onSubmit} className="space-y-3">
          {submit.error && <div className={FORM_ERROR_BANNER}>{submit.error}</div>}
          <div>
            <label htmlFor="x-handle-request" className={FORM_LABEL}>
              New X handle
            </label>
            <Input
              id="x-handle-request"
              required
              autoComplete="off"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="@handle"
              className="mt-1"
            />
          </div>
          <div>
            <label htmlFor="x-handle-reason" className={FORM_LABEL}>
              Reason (optional)
            </label>
            <Textarea
              id="x-handle-reason"
              rows={2}
              maxLength={X_HANDLE_REASON_MAX_LEN}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="For example, you renamed your X account."
              className="mt-1"
            />
          </div>
          {request?.status === "pending" && (
            <p className="text-xs text-neutral-500">
              This replaces your pending request.
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={submit.loading}>
              {submit.loading ? "Sending…" : "Send request"}
            </Button>
            <Button variant="ghost" onClick={closeForm}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        state && (
          <Button variant="secondary" onClick={() => setFormOpen(true)}>
            {bound ? "Request a change" : "Request a link"}
          </Button>
        )
      )}
    </div>
  );
}
