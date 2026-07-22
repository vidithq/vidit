"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Trash2 } from "lucide-react";

import {
  createInviteCode,
  listInviteCodes,
  revokeInviteCode,
  type AdminPurgeDetectedResponse,
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
import { ActionReceipt } from "@/components/admin/ActionReceipt";
import { UserActionsCard } from "@/components/admin/UserActionsCard";

// Invite lifecycle mapped onto the shared pill tones: active is the accent
// draw, revoked the red end-state, exhausted / expired the quiet neutral.
const STATUS_TONE: Record<InviteCodeStatus, PillTone> = {
  active: "accent",
  exhausted: "neutral",
  revoked: "danger",
  expired: "neutral",
};

const COLUMN_COUNT = 11;

function StatusChip({ status }: { status: InviteCodeStatus }) {
  return (
    <Pill tone={STATUS_TONE[status]} className="uppercase tracking-wider">
      {status}
    </Pill>
  );
}

function formatDay(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function InviteCodeRow({
  invite,
  expanded,
  onToggle,
  onRevoke,
}: {
  invite: InviteCode;
  expanded: boolean;
  onToggle: () => void;
  onRevoke: (id: string) => Promise<void>;
}) {
  const [revoking, setRevoking] = useState(false);
  const [copied, setCopied] = useState(false);

  const canRevoke = invite.status === "active" || invite.status === "exhausted";
  const redeemer = invite.redeemer;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(invite.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API fails on insecure contexts; code is on screen to copy by hand.
    }
  };

  const count = (value: number | undefined) =>
    value === undefined ? (
      <span className="text-neutral-600">—</span>
    ) : value === 0 ? (
      <span className="text-neutral-600">0</span>
    ) : (
      <span className="text-neutral-200">{value}</span>
    );

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
          {redeemer ? (
            <span title={invite.used_at ? new Date(invite.used_at).toLocaleString() : undefined}>
              @{redeemer.username}
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
          {formatDay(invite.expires_at)}
        </td>
        <td className="py-2 pr-3 text-xs text-right tabular-nums">
          {count(redeemer?.archives_imported)}
        </td>
        <td className="py-2 pr-3 text-xs text-right tabular-nums">
          {count(redeemer?.bot_detection_count)}
        </td>
        <td className="py-2 pr-3 text-xs text-right tabular-nums">
          {count(redeemer?.detected_count)}
        </td>
        <td className="py-2 pr-3 text-xs text-right tabular-nums">
          {count(redeemer?.geolocated_count)}
        </td>
        <td
          className="py-2 pr-3 text-xs text-neutral-400"
          title={
            redeemer?.last_login_at
              ? new Date(redeemer.last_login_at).toLocaleString()
              : undefined
          }
        >
          {formatDay(redeemer?.last_login_at ?? null)}
        </td>
        <td className="py-2 text-right whitespace-nowrap">
          {redeemer && (
            <Button variant="ghost" onClick={onToggle}>
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Manage
            </Button>
          )}
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
              className="ml-1"
            >
              <Trash2 size={12} />
              Revoke
            </Button>
          )}
        </td>
    </tr>
  );
}

export function OnboardingPanel() {
  const [codes, setCodes] = useState<InviteCode[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lastPurge, setLastPurge] = useState<AdminPurgeDetectedResponse | null>(
    null
  );

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

  const onPurged = (response: AdminPurgeDetectedResponse) => {
    setLastPurge(response);
    refresh();
  };

  // The card renders below the table (not as an expanded row) so it stays
  // put when the wide table scrolls horizontally.
  const managed =
    codes?.find((c) => c.id === expandedId)?.redeemer ?? null;

  return (
    <Card as="section">
      <header>
        <SectionEyebrow title="Onboarding" margin="none" />
        <p className="text-xs text-neutral-500 mt-0.5">
          Every code is single-use (one code, one analyst), so each row tracks
          one analyst&apos;s journey: archives imported, bot detections, live
          drafts, geolocations, last login. Mint, share via a trusted channel,
          then manage the code and the account from the row.
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
              <th className="py-2 pr-3 font-medium text-right">Archives</th>
              <th className="py-2 pr-3 font-medium text-right">Bot det.</th>
              <th className="py-2 pr-3 font-medium text-right">Detected</th>
              <th className="py-2 pr-3 font-medium text-right">Geolocs</th>
              <th className="py-2 pr-3 font-medium">Last login</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {codes === null ? (
              <tr>
                <td
                  colSpan={COLUMN_COUNT}
                  className="py-4 text-center text-xs text-neutral-500"
                >
                  Loading…
                </td>
              </tr>
            ) : codes.length === 0 ? (
              <tr>
                <td
                  colSpan={COLUMN_COUNT}
                  className="py-4 text-center text-xs text-neutral-500"
                >
                  No invite codes yet.
                </td>
              </tr>
            ) : (
              codes.map((c) => (
                <InviteCodeRow
                  key={c.id}
                  invite={c}
                  expanded={expandedId === c.id}
                  onToggle={() =>
                    setExpandedId((prev) => (prev === c.id ? null : c.id))
                  }
                  onRevoke={onRevoke}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {managed && (
        <UserActionsCard
          user={{
            id: managed.user_id,
            username: managed.username,
            email: managed.email ?? "",
            is_admin: managed.is_admin,
            is_trusted: managed.is_trusted,
            trust_reason: managed.trust_reason,
            x_handle: managed.x_handle,
          }}
          detectedCount={managed.detected_count}
          onUpdated={refresh}
          onDeleted={refresh}
          onPurged={onPurged}
        />
      )}

      {lastPurge && (
        <ActionReceipt
          mode="hard"
          header={<span className="font-medium">@{lastPurge.username}</span>}
        >
          <div className="text-neutral-500">
            {`Purged ${lastPurge.deleted_events} detected draft${
              lastPurge.deleted_events === 1 ? "" : "s"
            }, swept ${lastPurge.media_count} media row${
              lastPurge.media_count === 1 ? "" : "s"
            }. Account untouched.`}
          </div>
        </ActionReceipt>
      )}
    </Card>
  );
}
