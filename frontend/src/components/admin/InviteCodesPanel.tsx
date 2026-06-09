"use client";

import { useEffect, useState } from "react";
import { Copy, Trash2 } from "lucide-react";

import {
  createInviteCode,
  listInviteCodes,
  revokeInviteCode,
  type InviteCode,
  type InviteCodeStatus,
} from "@/lib/admin";
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

export function InviteCodesPanel() {
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
