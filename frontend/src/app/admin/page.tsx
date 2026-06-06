"use client";

import { notFound, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BadgeCheck, Copy, MapPin, Search, Trash2 } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/hooks/useAdmin";
import {
  createInviteCode,
  deleteGeolocation,
  deleteUser,
  listInviteCodes,
  reapAuthTokens,
  reapProofOrphans,
  revokeInviteCode,
  searchUsers,
  seedDemo,
  seedDemoBounties,
  setUserTrust,
  wipeDemo,
  wipeDemoBounties,
  type AdminGeolocationDeleteResponse,
  type AdminUser,
  type AdminUserDeleteResponse,
  type InviteCode,
  type InviteCodeStatus,
  type MaintenanceResponse,
  type SeedDemoBountiesResponse,
  type SeedDemoResponse,
  type WipeDemoBountiesResponse,
  type WipeDemoResponse,
} from "@/lib/admin";
import { PageCenter, PageShell } from "@/components/ui/PageShell";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import {
  FORM_INPUT_COMPACT,
  FORM_LABEL,
} from "@/components/ui/form-styles";



const STATUS_STYLES: Record<InviteCodeStatus, string> = {
  active: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  exhausted: "bg-neutral-800 text-neutral-400 border-neutral-700",
  revoked: "bg-red-500/10 text-red-300 border-red-500/30",
  expired: "bg-neutral-800 text-neutral-500 border-neutral-700",
};

function StatusChip({ status }: { status: InviteCodeStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] uppercase tracking-wider border ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function InviteCodeRow({
  invite,
  onRevoke,
}: {
  invite: InviteCode;
  onRevoke: (id: string) => Promise<void>;
}) {
  const [revoking, setRevoking] = useState(false);
  const [copied, setCopied] = useState(false);

  const canRevoke = invite.status === "active" || invite.status === "exhausted";

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(invite.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail on insecure contexts — silently no-op; the
      // code is visible on screen so the admin can still copy by hand.
    }
  };

  return (
    <tr className="border-b border-neutral-800 last:border-0">
      <td className="py-2 pr-3">
        <button
          type="button"
          onClick={onCopy}
          title={copied ? "Copied" : `Copy ${invite.code}`}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-neutral-300 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
        >
          <Copy size={12} className="text-neutral-500" />
          <span className="font-mono">
            {copied ? "Copied" : `${invite.code.slice(0, 6)}…`}
          </span>
        </button>
      </td>
      <td className="py-2 pr-3">
        <StatusChip status={invite.status} />
      </td>
      <td className="py-2 pr-3 text-xs text-neutral-400">
        {invite.used_by_username ? (
          <span title={invite.used_at ? formatDate(invite.used_at) : undefined}>
            @{invite.used_by_username}
          </span>
        ) : (
          <span className="text-neutral-600">—</span>
        )}
      </td>
      <td className="py-2 pr-3 text-xs text-neutral-400">
        {formatDate(invite.expires_at)}
      </td>
      <td className="py-2 pr-3 text-xs text-neutral-500">
        {formatDate(invite.created_at)}
      </td>
      <td className="py-2 text-right">
        {canRevoke && (
          <button
            type="button"
            disabled={revoking}
            onClick={async () => {
              setRevoking(true);
              try {
                await onRevoke(invite.id);
              } finally {
                setRevoking(false);
              }
            }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50 whitespace-nowrap"
          >
            <Trash2 size={12} />
            Revoke
          </button>
        )}
      </td>
    </tr>
  );
}

function InviteCodesPanel() {
  const [codes, setCodes] = useState<InviteCode[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [expiresInDays, setExpiresInDays] = useState<number | "">(14);
  const [creating, setCreating] = useState(false);

  const refresh = async () => {
    try {
      const rows = await listInviteCodes();
      setCodes(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invite codes");
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await createInviteCode({
        expires_in_days: expiresInDays === "" ? null : expiresInDays,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mint invite code");
    } finally {
      setCreating(false);
    }
  };

  const onRevoke = async (id: string) => {
    try {
      await revokeInviteCode(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke invite code");
    }
  };

  return (
    <section className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-5">
      <header>
        <h2 className="text-sm font-medium text-neutral-100">Invite codes</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          Every code is single-use — one code, one analyst — so the audit
          trail names exactly who joined with what. Mint, share via a
          trusted channel, revoke once it&apos;s done its job.
        </p>
      </header>

      <form
        onSubmit={onCreate}
        className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end"
      >
        <div>
          <label className={FORM_LABEL} htmlFor="expires">
            Expires in (days)
          </label>
          <input
            id="expires"
            type="number"
            min={1}
            max={365}
            placeholder="never"
            value={expiresInDays}
            onChange={(e) => {
              const v = e.target.value;
              setExpiresInDays(v === "" ? "" : Number(v));
            }}
            className={`mt-1 ${FORM_INPUT_COMPACT}`}
          />
        </div>
        <button
          type="submit"
          disabled={creating}
          className={`px-3 py-1.5 disabled:opacity-50 rounded-md text-xs font-medium ${PRIMARY_BUTTON}`}
        >
          {creating ? "Minting…" : "Mint code"}
        </button>
      </form>

      {error && (
        <div className="px-3 py-2 rounded-md text-xs text-red-300 bg-red-500/10 border border-red-500/30">
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
              <th className="py-2 pr-3 font-medium">Code</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">Used by</th>
              <th className="py-2 pr-3 font-medium">Expires</th>
              <th className="py-2 pr-3 font-medium">Created</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {codes === null ? (
              <tr>
                <td colSpan={6} className="py-4 text-center text-xs text-neutral-500">
                  Loading…
                </td>
              </tr>
            ) : codes.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-4 text-center text-xs text-neutral-500">
                  No invite codes yet.
                </td>
              </tr>
            ) : (
              codes.map((c) => (
                <InviteCodeRow key={c.id} invite={c} onRevoke={onRevoke} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

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
              <span className="text-[10px] uppercase tracking-wider text-neutral-500 border border-neutral-700 rounded px-1">
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

function TrustPanel() {
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

function GeolocationDeletePanel() {
  const [id, setId] = useState("");
  const [mode, setMode] = useState<"soft" | "hard">("soft");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AdminGeolocationDeleteResponse | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setConfirming(false);
    setId("");
    setMode("soft");
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim()) return;
    if (!confirming) {
      setConfirming(true);
      setError(null);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await deleteGeolocation(id.trim(), {
        hard: mode === "hard",
      });
      setResult(response);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-4">
      <header>
        <h2 className="text-sm font-medium text-neutral-100">
          Remove a geolocation
        </h2>
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
          <input
            id="geo-id"
            type="text"
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              setConfirming(false);
            }}
            placeholder="00000000-0000-0000-0000-000000000000"
            className={`mt-1 ${FORM_INPUT_COMPACT} font-mono`}
          />
        </div>

        <fieldset className="flex gap-2">
          <legend className={FORM_LABEL}>Mode</legend>
          {(["soft", "hard"] as const).map((m) => (
            <label
              key={m}
              className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-xs cursor-pointer border ${
                mode === m
                  ? m === "hard"
                    ? "bg-red-500/10 border-red-500/40 text-red-300"
                    : "bg-orange-500/15 border-orange-500/30 text-orange-300"
                  : "bg-neutral-800 border-neutral-700 text-neutral-400 hover:text-neutral-200"
              }`}
            >
              <input
                type="radio"
                name="delete-mode"
                value={m}
                checked={mode === m}
                onChange={() => {
                  setMode(m);
                  setConfirming(false);
                }}
                className="sr-only"
              />
              {m === "soft" ? "Soft delete (default)" : "Hard delete (GDPR)"}
            </label>
          ))}
        </fieldset>

        {error && (
          <div className="px-3 py-2 rounded-md text-xs text-red-300 bg-red-500/10 border border-red-500/30">
            {error}
          </div>
        )}

        {confirming && (
          <div className="px-3 py-2 rounded-md text-xs text-amber-300 bg-amber-500/5 border border-amber-500/30">
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
          <button
            type="submit"
            disabled={submitting || !id.trim()}
            className={`px-3 py-1.5 rounded-md text-xs font-medium disabled:opacity-50 ${
              mode === "hard"
                ? "bg-red-500 hover:bg-red-400 text-white transition-colors"
                : PRIMARY_BUTTON
            }`}
          >
            {submitting
              ? "Deleting…"
              : confirming
                ? "Confirm"
                : mode === "hard"
                  ? "Hard delete"
                  : "Soft delete"}
          </button>
          {confirming && (
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="px-3 py-1.5 rounded-md text-xs text-neutral-400 hover:text-neutral-200"
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      {result && (
        <div className="px-3 py-2 rounded-md text-xs text-neutral-300 bg-neutral-800/60 border border-neutral-700 space-y-1">
          <div className="inline-flex items-center gap-1.5">
            <MapPin size={12} className="text-orange-400" />
            <span className="font-medium">{result.title}</span>
            <span
              className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                result.mode === "hard"
                  ? "border-red-500/30 text-red-300"
                  : "border-orange-500/30 text-orange-300"
              }`}
            >
              {result.mode}
            </span>
          </div>
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
        </div>
      )}
    </section>
  );
}

function DemoDataPanel() {
  const [count, setCount] = useState(100);
  const [seeding, setSeeding] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [lastSeed, setLastSeed] = useState<SeedDemoResponse | null>(null);
  const [lastWipe, setLastWipe] = useState<WipeDemoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSeed = async () => {
    setError(null);
    setSeeding(true);
    try {
      const result = await seedDemo(count);
      setLastSeed(result);
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
      const result = await wipeDemo();
      setLastWipe(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to wipe");
    } finally {
      setWiping(false);
    }
  };

  return (
    <section className="border border-neutral-800 rounded-lg bg-neutral-900/50">
      <header className="px-4 py-3 border-b border-neutral-800">
        <h2 className="text-sm font-medium text-neutral-200">Demo data</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          Generate synthetic geolocations from the curated{" "}
          <code className="text-neutral-400">demo-pool/</code> S3 prefix.
          Demo authors and rows are flagged{" "}
          <code className="text-neutral-400">is_demo</code>; wipe drops every
          flagged row in one go (the pool itself stays).
        </p>
      </header>
      <div className="px-4 py-3 space-y-3">
        <div className="flex items-end gap-3">
          <div className="flex-1 max-w-[180px]">
            <label className={FORM_LABEL} htmlFor="seed-count">
              Count
            </label>
            <input
              id="seed-count"
              type="number"
              min={1}
              max={50000}
              value={count}
              onChange={(e) =>
                setCount(
                  Math.max(1, Math.min(50000, Number(e.target.value) || 1))
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
            {seeding ? "Generating…" : "Generate demo data"}
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
                : "Wipe all demo data"}
          </button>
        </div>

        {lastSeed && (
          <p className="text-xs text-neutral-400">
            Last seeded: {lastSeed.created} geos across{" "}
            {lastSeed.templates} template{lastSeed.templates === 1 ? "" : "s"}.
          </p>
        )}
        {lastWipe && (
          <p className="text-xs text-neutral-400">
            Last wiped: {lastWipe.deleted_geos} geos,{" "}
            {lastWipe.deleted_users} demo users.
          </p>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </section>
  );
}

function DemoBountiesPanel() {
  const [count, setCount] = useState(20);
  const [seeding, setSeeding] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [lastSeed, setLastSeed] =
    useState<SeedDemoBountiesResponse | null>(null);
  const [lastWipe, setLastWipe] =
    useState<WipeDemoBountiesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSeed = async () => {
    setError(null);
    setSeeding(true);
    try {
      const result = await seedDemoBounties(count);
      setLastSeed(result);
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
      const result = await wipeDemoBounties();
      setLastWipe(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to wipe");
    } finally {
      setWiping(false);
    }
  };

  return (
    <section className="border border-neutral-800 rounded-lg bg-neutral-900/50">
      <header className="px-4 py-3 border-b border-neutral-800">
        <h2 className="text-sm font-medium text-neutral-200">Demo bounties</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          Generate synthetic bounties from the same{" "}
          <code className="text-neutral-400">demo-pool/</code> imagery the
          geolocation seeder uses. Authors are the existing demo pool;
          rows are flagged <code className="text-neutral-400">is_demo</code>{" "}
          and spread across the lifecycle (most open, a few fulfilled with a
          paired demo geolocation, a few closed) so the status-filter chips
          and the &ldquo;originally posted as a bounty&rdquo; trace banner
          all exercise. A fraction of open bounties get random claims
          attached so the &ldquo;N working&rdquo; badge has something to
          render. Wipe drops every flagged bounty (demo users and demo
          geos stay).
        </p>
      </header>
      <div className="px-4 py-3 space-y-3">
        <div className="flex items-end gap-3">
          <div className="flex-1 max-w-[180px]">
            <label className={FORM_LABEL} htmlFor="seed-bounty-count">
              Count
            </label>
            <input
              id="seed-bounty-count"
              type="number"
              min={1}
              max={5000}
              value={count}
              onChange={(e) =>
                setCount(
                  Math.max(1, Math.min(5000, Number(e.target.value) || 1))
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
            {seeding ? "Generating…" : "Generate demo bounties"}
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
                : "Wipe all demo bounties"}
          </button>
        </div>

        {lastSeed && (
          <p className="text-xs text-neutral-400">
            Last seeded: {lastSeed.created} bounties across{" "}
            {lastSeed.templates} template
            {lastSeed.templates === 1 ? "" : "s"} · {lastSeed.open} open,{" "}
            {lastSeed.fulfilled} fulfilled, {lastSeed.closed} closed ·{" "}
            {lastSeed.with_claims} with claims.
          </p>
        )}
        {lastWipe && (
          <p className="text-xs text-neutral-400">
            Last wiped: {lastWipe.deleted_bounties} demo bounties.
          </p>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </section>
  );
}

function MaintenancePanel() {
  const [authResult, setAuthResult] = useState<MaintenanceResponse | null>(
    null
  );
  const [orphanResult, setOrphanResult] = useState<MaintenanceResponse | null>(
    null
  );
  const [running, setRunning] = useState<"auth" | "orphans" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onReapAuth = async () => {
    setError(null);
    setRunning("auth");
    try {
      setAuthResult(await reapAuthTokens());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setRunning(null);
    }
  };

  const onReapOrphans = async () => {
    setError(null);
    setRunning("orphans");
    try {
      setOrphanResult(await reapProofOrphans());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setRunning(null);
    }
  };

  return (
    <section className="border border-neutral-800 rounded-lg bg-neutral-900/50">
      <header className="px-4 py-3 border-b border-neutral-800">
        <h2 className="text-sm font-medium text-neutral-200">Maintenance</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          On-demand reapers. Click when you remember — there&apos;s no schedule.
        </p>
      </header>
      <div className="px-4 py-3 space-y-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onReapAuth}
            disabled={running !== null}
            className="px-3 py-1.5 rounded-md text-sm border border-neutral-700 bg-neutral-800 text-neutral-200 hover:bg-neutral-700 disabled:opacity-50 transition-colors"
          >
            {running === "auth" ? "Reaping…" : "Reap expired auth tokens"}
          </button>
          {authResult && (
            <span className="text-xs text-neutral-400">
              Expired: {authResult.expired ?? 0} · Old consumed:{" "}
              {authResult.old_consumed ?? 0}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onReapOrphans}
            disabled={running !== null}
            className="px-3 py-1.5 rounded-md text-sm border border-neutral-700 bg-neutral-800 text-neutral-200 hover:bg-neutral-700 disabled:opacity-50 transition-colors"
          >
            {running === "orphans"
              ? "Reaping…"
              : "Reap orphan proof images"}
          </button>
          {orphanResult && (
            <span className="text-xs text-neutral-400">
              Rows: {orphanResult.rows_deleted ?? 0} · S3:{" "}
              {orphanResult.s3_deleted ?? 0}
              {orphanResult.s3_failed
                ? ` · failed: ${orphanResult.s3_failed}`
                : ""}
            </span>
          )}
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </section>
  );
}

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: adminLoading } = useAdmin();
  const router = useRouter();

  // While the auth/admin probes resolve, don't decide anything — otherwise
  // an admin would see "Loading… → 404" on first paint as the probes race.
  const probing = authLoading || adminLoading;

  useEffect(() => {
    if (!probing && !user) {
      router.push("/login?next=/admin");
    }
  }, [probing, user, router]);

  if (probing || !user) {
    return (
      <PageCenter>
        <span className="text-neutral-500">Loading…</span>
      </PageCenter>
    );
  }

  if (!isAdmin) {
    notFound();
  }

  return (
    <PageShell title="Admin">
      <InviteCodesPanel />
      <TrustPanel />
      <GeolocationDeletePanel />
      <DemoDataPanel />
      <DemoBountiesPanel />
      <MaintenancePanel />
    </PageShell>
  );
}
