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
import { errorMessage } from "@/lib/api";
import { useMutation } from "@/hooks/useMutation";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import {
  FORM_ERROR_BANNER,
  FORM_LABEL,
  LABEL_TEXT,
} from "@/components/ui/form-styles";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Pill, type PillTone } from "@/components/ui/Pill";

// Invite lifecycle mapped onto the shared pill tones: active is the accent
// draw, revoked the red end-state, exhausted / expired the quiet neutral.
const STATUS_TONE: Record<InviteCodeStatus, PillTone> = {
  active: "accent",
  exhausted: "neutral",
  revoked: "danger",
  expired: "neutral",
};

function StatusChip({ status }: { status: InviteCodeStatus }) {
  return (
    <Pill tone={STATUS_TONE[status]} className="uppercase tracking-wider">
      {status}
    </Pill>
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
      // Clipboard API fails on insecure contexts; code is on screen to copy by hand.
    }
  };

  return (
    <tr className="border-b border-neutral-800 last:border-0">
      <td className="py-2 pr-3">
        <Button
          variant="ghost"
          onClick={onCopy}
          title={copied ? "Copied" : `Copy ${invite.code}`}
        >
          <Copy size={12} className="text-neutral-500" />
          <span className="font-mono">
            {copied ? "Copied" : `${invite.code.slice(0, 6)}…`}
          </span>
        </Button>
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
      <td className="py-2 pr-3">
        {invite.x_handle ? (
          <Pill>@{invite.x_handle}</Pill>
        ) : (
          <span className="text-xs text-neutral-600">—</span>
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
          <Button
            variant="danger"
            disabled={revoking}
            onClick={async () => {
              setRevoking(true);
              try {
                await onRevoke(invite.id);
              } finally {
                setRevoking(false);
              }
            }}
            className="whitespace-nowrap"
          >
            <Trash2 size={12} />
            Revoke
          </Button>
        )}
      </td>
    </tr>
  );
}

export function InviteCodesPanel() {
  const [codes, setCodes] = useState<InviteCode[] | null>(null);

  const [expiresInDays, setExpiresInDays] = useState<number | "">(14);
  const [xHandle, setXHandle] = useState("");

  // The mint action owns the one error slot; the loader and revoke (which has
  // no loading of its own — the row owns that) write to it via `setError`, so
  // the panel keeps a single shared error like before.
  const createMutation = useMutation(
    () =>
      createInviteCode({
        expires_in_days: expiresInDays === "" ? null : expiresInDays,
        x_handle: xHandle.trim() === "" ? null : xHandle.trim(),
      }),
    {
      fallback: "Failed to mint invite code",
      onSuccess: () => {
        setXHandle("");
        refresh();
      },
    }
  );
  const { error, setError } = createMutation;
  const creating = createMutation.loading;

  const refresh = async () => {
    try {
      const rows = await listInviteCodes();
      setCodes(rows);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Failed to load invite codes"));
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await createMutation.run();
  };

  const onRevoke = async (id: string) => {
    try {
      await revokeInviteCode(id);
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Failed to revoke invite code"));
    }
  };

  return (
    <Card as="section">
      <header>
        <SectionEyebrow title="Invite codes" margin="none" />
        <p className="text-xs text-neutral-500 mt-0.5">
          Every code is single-use (one code, one analyst), so the audit
          trail names exactly who joined with what. Mint, share via a
          trusted channel, revoke once it&apos;s done its job.
        </p>
      </header>

      <form
        onSubmit={onCreate}
        className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end"
      >
        <div>
          <label className={FORM_LABEL} htmlFor="expires">
            Expires in (days)
          </label>
          <Input
            variant="compact"
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
            className="mt-1"
          />
        </div>
        <div>
          <label className={FORM_LABEL} htmlFor="invite-x-handle">
            X handle (optional, linked to the account at redemption)
          </label>
          <Input
            variant="compact"
            id="invite-x-handle"
            type="text"
            placeholder="e.g. @osint_hawk"
            value={xHandle}
            onChange={(e) => setXHandle(e.target.value)}
            className="mt-1"
          />
        </div>
        <Button type="submit" disabled={creating}>
          {creating ? "Minting…" : "Mint code"}
        </Button>
      </form>

      {error && (
        <div className={FORM_ERROR_BANNER}>
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className={LABEL_TEXT}>
              <th className="py-2 pr-3 font-medium">Code</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">Used by</th>
              <th className="py-2 pr-3 font-medium">X handle</th>
              <th className="py-2 pr-3 font-medium">Expires</th>
              <th className="py-2 pr-3 font-medium">Created</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {codes === null ? (
              <tr>
                <td colSpan={7} className="py-4 text-center text-xs text-neutral-500">
                  Loading…
                </td>
              </tr>
            ) : codes.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-4 text-center text-xs text-neutral-500">
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
    </Card>
  );
}
