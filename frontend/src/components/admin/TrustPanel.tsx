"use client";

import { useState } from "react";
import { BadgeCheck, Search } from "lucide-react";

import {
  deleteUser,
  searchUsers,
  setUserTrust,
  type AdminUser,
  type AdminUserDeleteResponse,
} from "@/lib/admin";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { useMutation } from "@/hooks/useMutation";
import { MUTED_LINK } from "@/components/ui/styles";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import {
  FORM_ERROR_BANNER,
  FORM_LABEL,
} from "@/components/ui/form-styles";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

function TrustUserRow({
  user,
  onUpdated,
  onDeleted,
}: {
  user: AdminUser;
  onUpdated: (u: AdminUser) => void;
  onDeleted: (userId: string, response: AdminUserDeleteResponse) => void;
}) {
  const [reason, setReason] = useState(user.trust_reason ?? "");
  const [showReasonForm, setShowReasonForm] = useState(false);
  const [deleteMode, setDeleteMode] = useState<"soft" | "hard" | null>(null);

  const grantMutation = useMutation(
    () =>
      setUserTrust(user.id, {
        is_trusted: true,
        trust_reason: reason.trim(),
      }),
    {
      fallback: "Failed to grant trust",
      onSuccess: (updated) => {
        onUpdated(updated);
        setShowReasonForm(false);
      },
    }
  );

  const revokeMutation = useMutation(
    () =>
      setUserTrust(user.id, {
        is_trusted: false,
        trust_reason: null,
      }),
    {
      fallback: "Failed to revoke trust",
      onSuccess: (updated) => {
        onUpdated(updated);
        setReason("");
      },
    }
  );

  const deleteMutation = useMutation(
    (hard: boolean) => deleteUser(user.id, { hard }),
    {
      fallback: "Failed to delete user",
      onSuccess: (response) => {
        onDeleted(user.id, response);
        setDeleteMode(null);
        confirmDelete.cancel();
      },
    }
  );

  const granting = grantMutation.loading || revokeMutation.loading;
  const deleting = deleteMutation.loading;
  // One shared error slot across the row's three actions; each action clears
  // the others (mirrors the old single `setError(null)` per handler).
  const error =
    grantMutation.error ?? revokeMutation.error ?? deleteMutation.error;

  const trusted = user.is_trusted;

  const submitGrant = () => {
    revokeMutation.reset();
    deleteMutation.reset();
    if (!reason.trim()) {
      grantMutation.setError("A reason is required when granting trust.");
      return;
    }
    void grantMutation.run();
  };

  const submitRevoke = () => {
    grantMutation.reset();
    deleteMutation.reset();
    void revokeMutation.run();
  };

  const submitDelete = () => {
    if (deleteMode === null) return;
    grantMutation.reset();
    revokeMutation.reset();
    void deleteMutation.run(deleteMode === "hard");
  };

  const confirmDelete = useConfirmAction(() => submitDelete());

  const cancelDelete = () => {
    setDeleteMode(null);
    confirmDelete.cancel();
    grantMutation.reset();
    revokeMutation.reset();
    deleteMutation.reset();
  };

  return (
    <div className="border border-neutral-800 rounded-md p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-neutral-100 inline-flex items-center gap-1.5">
            @{user.username}
            {trusted && (
              <BadgeCheck size={14} className="text-orange-500" strokeWidth={1.8} />
            )}
            {user.is_admin && (
              <span className="text-[10px] uppercase tracking-wider text-neutral-500 border border-neutral-700 rounded-sm px-1">
                admin
              </span>
            )}
          </div>
          <div className="text-xs text-neutral-500 truncate">{user.email}</div>
          {trusted && user.trust_reason && (
            <div className="text-xs text-neutral-400 mt-1 italic">
              “{user.trust_reason}”
            </div>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          {trusted ? (
            <Button
              variant="ghost-danger"
              disabled={granting}
              onClick={submitRevoke}
              className="whitespace-nowrap"
            >
              Revoke trust
            </Button>
          ) : showReasonForm ? null : (
            <Button
              variant="ghost"
              onClick={() => setShowReasonForm(true)}
              className="whitespace-nowrap"
            >
              Grant trust
            </Button>
          )}
          {deleteMode === null && !showReasonForm && (
            <div className="inline-flex gap-1">
              <Button
                variant="ghost"
                onClick={() => {
                  setDeleteMode("soft");
                  confirmDelete.cancel();
                }}
                className="whitespace-nowrap"
              >
                Soft delete
              </Button>
              <Button
                variant="ghost-danger"
                onClick={() => {
                  setDeleteMode("hard");
                  confirmDelete.cancel();
                }}
                className="whitespace-nowrap"
              >
                Hard delete
              </Button>
            </div>
          )}
        </div>
      </div>

      {!trusted && showReasonForm && (
        <div className="space-y-2">
          <label className={FORM_LABEL} htmlFor={`reason-${user.id}`}>
            Reason (public — surfaces in the badge tooltip)
          </label>
          <Input
            variant="compact"
            id={`reason-${user.id}`}
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Established OSINT track record on X"
          />
          <div className="flex gap-2">
            <Button variant="primary" onClick={submitGrant} disabled={granting}>
              {granting ? "Granting…" : "Confirm grant"}
            </Button>
            <button
              type="button"
              onClick={() => {
                setShowReasonForm(false);
                setReason(user.trust_reason ?? "");
                grantMutation.reset();
                revokeMutation.reset();
                deleteMutation.reset();
              }}
              className={`px-3 py-1.5 rounded-md text-xs ${MUTED_LINK}`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {deleteMode !== null && (
        <div
          className={`px-3 py-2 rounded-md text-xs space-y-2 border ${
            deleteMode === "hard"
              ? "bg-red-500/5 border-red-500/30 text-red-200"
              : "bg-amber-500/5 border-amber-500/30 text-amber-200"
          }`}
        >
          {deleteMode === "hard" ? (
            <p>
              <strong>Hard delete is irreversible.</strong> Drops @
              {user.username}, every geolocation they authored, their
              media, and S3 objects.{" "}
              {!confirmDelete.armed && "Click “Confirm” to proceed."}
            </p>
          ) : (
            <p>
              Soft-deleting will hide @{user.username} from public reads and
              cascade-hide every geolocation they authored.{" "}
              {!confirmDelete.armed && "Click “Confirm” to proceed."}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              variant={deleteMode === "hard" ? "danger" : "primary"}
              onClick={confirmDelete.trigger}
              disabled={deleting}
            >
              {deleting
                ? "Deleting…"
                : confirmDelete.armed
                  ? "Confirm"
                  : deleteMode === "hard"
                    ? "Hard delete"
                    : "Soft delete"}
            </Button>
            <button
              type="button"
              onClick={cancelDelete}
              className={`px-3 py-1.5 rounded-md text-xs ${MUTED_LINK}`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="text-xs text-red-300">{error}</div>
      )}
    </div>
  );
}

export function TrustPanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminUser[] | null>(null);
  const [lastDelete, setLastDelete] = useState<AdminUserDeleteResponse | null>(
    null
  );

  const searchMutation = useMutation(() => searchUsers(query), {
    fallback: "Search failed",
    onSuccess: setResults,
  });
  const searching = searchMutation.loading;
  const error = searchMutation.error;

  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setLastDelete(null);
    await searchMutation.run();
  };

  const onUpdated = (u: AdminUser) => {
    setResults((prev) =>
      prev ? prev.map((row) => (row.id === u.id ? u : row)) : prev
    );
  };

  const onDeleted = (userId: string, response: AdminUserDeleteResponse) => {
    // Drop the row: the user is now gone (hard) or hidden from reads (soft).
    setResults((prev) => (prev ? prev.filter((r) => r.id !== userId) : prev));
    setLastDelete(response);
  };

  return (
    <Card as="section">
      <header>
        <SectionEyebrow title="Manage analysts" margin="none" />
        <p className="text-xs text-neutral-500 mt-0.5">
          Find an analyst by username or email, then act on the row. Three
          actions per analyst: <span className="text-orange-400">grant or
          revoke trust</span> (the orange checkmark, with a public reason
          surfaced in the badge tooltip),{" "}
          <span className="text-amber-300">soft delete</span> (hide them and
          everything they&apos;ve posted from public view), or{" "}
          <span className="text-red-300">hard delete</span> (GDPR erasure —
          drops the user, their geolocations, and their S3 media).
        </p>
      </header>

      <form
        onSubmit={onSearch}
        className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end"
      >
        <div>
          <label className={FORM_LABEL} htmlFor="user-search">
            Find an analyst (username or email)
          </label>
          <Input
            variant="compact"
            id="user-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="username or email"
            className="mt-1"
          />
        </div>
        <Button
          type="submit"
          variant="neutral"
          disabled={searching || !query.trim()}
        >
          <Search size={12} />
          {searching ? "Searching…" : "Search"}
        </Button>
      </form>

      {error && (
        <div className={FORM_ERROR_BANNER}>
          {error}
        </div>
      )}

      {results !== null && (
        <div className="space-y-2">
          {results.length === 0 ? (
            <div className="text-xs text-neutral-500 py-2">
              No analysts match.
            </div>
          ) : (
            results.map((u) => (
              <TrustUserRow
                key={u.id}
                user={u}
                onUpdated={onUpdated}
                onDeleted={onDeleted}
              />
            ))
          )}
        </div>
      )}

      {lastDelete && (
        <div className="px-3 py-2 rounded-md text-xs text-neutral-300 bg-neutral-800/60 border border-neutral-700 space-y-1">
          <div className="inline-flex items-center gap-1.5">
            <span className="font-medium">@{lastDelete.username}</span>
            <span
              className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                lastDelete.mode === "hard"
                  ? "border-red-500/30 text-red-300"
                  : "border-amber-500/30 text-amber-300"
              }`}
            >
              {lastDelete.mode}
            </span>
          </div>
          <div className="text-neutral-500">
            {lastDelete.mode === "hard"
              ? `Dropped ${lastDelete.cascaded_geolocations} geolocation${
                  lastDelete.cascaded_geolocations === 1 ? "" : "s"
                }, swept ${lastDelete.media_count} media + ${
                  lastDelete.proof_image_count
                } proof image${lastDelete.proof_image_count === 1 ? "" : "s"}.`
              : `Cascade-hid ${lastDelete.cascaded_geolocations} geolocation${
                  lastDelete.cascaded_geolocations === 1 ? "" : "s"
                }.`}
          </div>
        </div>
      )}
    </Card>
  );
}
