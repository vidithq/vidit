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
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import {
  FORM_INPUT_COMPACT,
  FORM_LABEL,
} from "@/components/ui/form-styles";

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
  const [granting, setGranting] = useState(false);
  const [showReasonForm, setShowReasonForm] = useState(false);
  const [deleteMode, setDeleteMode] = useState<"soft" | "hard" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trusted = user.is_trusted;

  const submitGrant = async () => {
    if (!reason.trim()) {
      setError("A reason is required when granting trust.");
      return;
    }
    setGranting(true);
    setError(null);
    try {
      const updated = await setUserTrust(user.id, {
        is_trusted: true,
        trust_reason: reason.trim(),
      });
      onUpdated(updated);
      setShowReasonForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to grant trust");
    } finally {
      setGranting(false);
    }
  };

  const submitRevoke = async () => {
    setGranting(true);
    setError(null);
    try {
      const updated = await setUserTrust(user.id, {
        is_trusted: false,
        trust_reason: null,
      });
      onUpdated(updated);
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke trust");
    } finally {
      setGranting(false);
    }
  };

  const submitDelete = async () => {
    if (deleteMode === null) return;
    setDeleting(true);
    setError(null);
    try {
      const response = await deleteUser(user.id, { hard: deleteMode === "hard" });
      onDeleted(user.id, response);
      setDeleteMode(null);
      setConfirming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete user");
    } finally {
      setDeleting(false);
    }
  };

  const cancelDelete = () => {
    setDeleteMode(null);
    setConfirming(false);
    setError(null);
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
            <button
              type="button"
              disabled={granting}
              onClick={submitRevoke}
              className="px-2 py-1 rounded-md text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50 whitespace-nowrap"
            >
              Revoke trust
            </button>
          ) : showReasonForm ? null : (
            <button
              type="button"
              onClick={() => setShowReasonForm(true)}
              className="px-2 py-1 rounded-md text-xs text-orange-400 hover:bg-orange-500/10 whitespace-nowrap"
            >
              Grant trust
            </button>
          )}
          {deleteMode === null && !showReasonForm && (
            <div className="inline-flex gap-1">
              <button
                type="button"
                onClick={() => {
                  setDeleteMode("soft");
                  setConfirming(false);
                }}
                className="px-2 py-1 rounded-md text-xs text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 whitespace-nowrap"
              >
                Soft delete
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeleteMode("hard");
                  setConfirming(false);
                }}
                className="px-2 py-1 rounded-md text-xs text-red-400 hover:bg-red-500/10 whitespace-nowrap"
              >
                Hard delete
              </button>
            </div>
          )}
        </div>
      </div>

      {!trusted && showReasonForm && (
        <div className="space-y-2">
          <label className={FORM_LABEL} htmlFor={`reason-${user.id}`}>
            Reason (public — surfaces in the badge tooltip)
          </label>
          <input
            id={`reason-${user.id}`}
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Established OSINT track record on X"
            className={FORM_INPUT_COMPACT}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submitGrant}
              disabled={granting}
              className={`px-3 py-1.5 disabled:opacity-50 rounded-md text-xs font-medium ${PRIMARY_BUTTON}`}
            >
              {granting ? "Granting…" : "Confirm grant"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowReasonForm(false);
                setReason(user.trust_reason ?? "");
                setError(null);
              }}
              className="px-3 py-1.5 rounded-md text-xs text-neutral-400 hover:text-neutral-200"
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
              {!confirming && "Click “Confirm” to proceed."}
            </p>
          ) : (
            <p>
              Soft-deleting will hide @{user.username} from public reads and
              cascade-hide every geolocation they authored.{" "}
              {!confirming && "Click “Confirm” to proceed."}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (!confirming) {
                  setConfirming(true);
                  return;
                }
                submitDelete();
              }}
              disabled={deleting}
              className={`px-3 py-1.5 rounded-md text-xs font-medium disabled:opacity-50 ${
                deleteMode === "hard"
                  ? "bg-red-500 hover:bg-red-400 text-white transition-colors"
                  : PRIMARY_BUTTON
              }`}
            >
              {deleting
                ? "Deleting…"
                : confirming
                  ? "Confirm"
                  : deleteMode === "hard"
                    ? "Hard delete"
                    : "Soft delete"}
            </button>
            <button
              type="button"
              onClick={cancelDelete}
              className="px-3 py-1.5 rounded-md text-xs text-neutral-400 hover:text-neutral-200"
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
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDelete, setLastDelete] = useState<AdminUserDeleteResponse | null>(
    null
  );

  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setSearching(true);
    setError(null);
    setLastDelete(null);
    try {
      setResults(await searchUsers(query));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const onUpdated = (u: AdminUser) => {
    setResults((prev) =>
      prev ? prev.map((row) => (row.id === u.id ? u : row)) : prev
    );
  };

  const onDeleted = (userId: string, response: AdminUserDeleteResponse) => {
    // Drop the row from the result list — the user is gone (hard) or
    // hidden from public reads (soft); either way the admin shouldn't see
    // them in subsequent searches without explicitly re-querying.
    setResults((prev) => (prev ? prev.filter((r) => r.id !== userId) : prev));
    setLastDelete(response);
  };

  return (
    <section className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-4">
      <header>
        <h2 className="text-sm font-medium text-neutral-100">Manage analysts</h2>
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
          <input
            id="user-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="username or email"
            className={`mt-1 ${FORM_INPUT_COMPACT}`}
          />
        </div>
        <button
          type="submit"
          disabled={searching || !query.trim()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 disabled:opacity-50 rounded-md text-xs text-neutral-200"
        >
          <Search size={12} />
          {searching ? "Searching…" : "Search"}
        </button>
      </form>

      {error && (
        <div className="px-3 py-2 rounded-md text-xs text-red-300 bg-red-500/10 border border-red-500/30">
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
    </section>
  );
}
