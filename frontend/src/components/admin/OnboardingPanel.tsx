"use client";

import { useCallback, useState } from "react";
import {
  AtSign,
  Ban,
  Bot,
  ChevronDown,
  ChevronRight,
  Copy,
  Ellipsis,
  FileArchive,
  MapPin,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import {
  createInviteCode,
  deleteInviteCode,
  inviteCodesPath,
  revokeInviteCode,
  type InviteCode,
} from "@/lib/admin";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { useCursorList } from "@/hooks/useCursorList";
import { LoadMoreRow } from "@/components/ui/LoadMoreRow";
import { useMutation } from "@/hooks/useMutation";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import {
  FORM_ERROR_BANNER,
  FORM_LABEL,
  LABEL_TEXT,
} from "@/components/ui/form-styles";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Pill";
import { InviteStatusPill } from "@/components/invites/InviteStatusPill";
import { UserOutcomeReceipt, type UserOutcome } from "@/components/admin/ActionReceipt";
import { UserActionsCard } from "@/components/admin/UserActionsCard";

const COLUMN_COUNT = 11;

// Header cell for the per-analyst stat columns: the app-wide glyph stands in for the label
// (FileArchive imports, Bot detections, MapPin geolocations, AtSign X-bot detections from
// mentions), kept as tooltip and for screen readers.
function StatHeader({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <th className="py-2 pr-3 font-medium" title={label}>
      <span className="flex justify-end">
        <Icon size={14} aria-hidden />
        <span className="sr-only">{label}</span>
      </span>
    </th>
  );
}

function formatDay(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

type InviteAction = "revoke" | "delete";

const INVITE_ACTIONS: Record<
  InviteAction,
  { label: string; title: string; body: string; busy: string; fallback: string }
> = {
  revoke: {
    label: "Revoke",
    title: "Revoke this invite code?",
    body: "The code stops working at once and cannot be turned back on. Its row stays in the table.",
    busy: "Revoking…",
    fallback: "Failed to revoke invite code",
  },
  delete: {
    label: "Delete",
    title: "Delete this invite code?",
    body: "Drops the row for good. The code was never used, so no account depends on it.",
    busy: "Deleting…",
    fallback: "Failed to delete invite code",
  },
};

function InviteCodeRow({
  invite,
  expanded,
  onToggle,
  onRevoked,
  onDeleted,
}: {
  invite: InviteCode;
  expanded: boolean;
  onToggle: () => void;
  onRevoked: () => void;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState<InviteAction | null>(null);
  const { copied, copy } = useCopyToClipboard();

  const action = useMutation(
    async (kind: InviteAction) => {
      await (kind === "revoke" ? revokeInviteCode(invite.id) : deleteInviteCode(invite.id));
    },
    {
      fallback: confirming ? INVITE_ACTIONS[confirming].fallback : undefined,
      onSuccess: (_result, kind) => {
        setConfirming(null);
        // Either write changes what the first page holds: the panel restarts the walk.
        if (kind === "revoke") onRevoked();
        else onDeleted();
      },
    },
  );

  // Revoking retires a live code: the item stands only where there is one to retire.
  const canRevoke = invite.status === "active";
  const redeemer = invite.redeemer;
  // Deletion drops the row, which the backend allows only while no account was created from the
  // code. Same predicate here, so the item stands exactly where it works.
  const canDelete = redeemer == null;

  const onCopy = () => void copy(invite.code);

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
        <InviteStatusPill status={invite.status} usedAt={invite.used_at} />
      </td>
      <td className="py-2 pr-3 text-xs text-neutral-400">
        {invite.sponsor ? (
          invite.sponsor.username
        ) : (
          <span className="text-neutral-600">admin</span>
        )}
      </td>
      <td className="py-2 pr-3 text-xs text-neutral-400">
        {redeemer ? (
          <span className="inline-flex items-center gap-1.5">
            <span
              title={
                invite.used_at
                  ? new Date(invite.used_at).toLocaleString()
                  : undefined
              }
            >
              {redeemer.username}
            </span>
            {redeemer.deleted_at && <Pill tone="danger">Soft-deleted</Pill>}
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
          redeemer?.last_seen_at
            ? new Date(redeemer.last_seen_at).toLocaleString()
            : undefined
        }
      >
        {formatDay(redeemer?.last_seen_at ?? null)}
      </td>
      <td className="py-2 text-right whitespace-nowrap">
        <div className="inline-flex items-center gap-1">
          {redeemer && (
            <Button variant="ghost" onClick={onToggle}>
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Manage
            </Button>
          )}
          {(canRevoke || canDelete) && (
            <ActionMenu
              label={`More actions for ${invite.code.slice(0, 6)}`}
              icon={<Ellipsis size={14} />}
              items={[
                ...(canRevoke
                  ? [
                      {
                        key: "revoke",
                        label: INVITE_ACTIONS.revoke.label,
                        icon: <Ban size={14} aria-hidden />,
                        onSelect: () => setConfirming("revoke"),
                      },
                    ]
                  : []),
                ...(canDelete
                  ? [
                      {
                        key: "delete",
                        label: INVITE_ACTIONS.delete.label,
                        icon: <Trash2 size={14} aria-hidden />,
                        onSelect: () => setConfirming("delete"),
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </div>
        {confirming && (
          <ConfirmDialog
            title={INVITE_ACTIONS[confirming].title}
            confirmLabel={INVITE_ACTIONS[confirming].label}
            busyLabel={INVITE_ACTIONS[confirming].busy}
            busy={action.loading}
            error={action.error}
            tone="danger"
            onConfirm={() => void action.run(confirming)}
            onCancel={() => {
              setConfirming(null);
              action.reset();
            }}
          >
            <p>{INVITE_ACTIONS[confirming].body}</p>
          </ConfirmDialog>
        )}
      </td>
    </tr>
  );
}

export function OnboardingPanel() {
  // The invite table is capped and cursor-paged (the whole table returns only its first 100 rows),
  // so the console walks it with Show more.
  const buildPath = useCallback(
    (cursor: string | null) => inviteCodesPath(cursor),
    [],
  );
  const walk = useCursorList<InviteCode>(buildPath);
  const { items: codes, loading, reload } = walk;
  // A failed later page shows in the load-more row; only a failed first page leaves no rows.
  const loadError = codes.length === 0 ? walk.error : null;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<UserOutcome | null>(null);

  const [expiresInDays, setExpiresInDays] = useState<number | "">(14);
  const [xHandle, setXHandle] = useState("");

  // The mint's error and the loader's share the banner; a row's revoke or delete shows its refusal
  // in its dialog.
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
        reload();
      },
    },
  );
  const { error } = createMutation;
  const creating = createMutation.loading;

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await createMutation.run();
  };

  const onOutcome = (next: UserOutcome) => {
    setOutcome(next);
    reload();
  };

  // The card renders below the table (not as an expanded row) so it stays put when the wide table
  // scrolls horizontally.
  const managedCode = codes.find((c) => c.id === expandedId);
  const managed = managedCode?.redeemer ?? null;

  return (
    <Card as="section">
      <header>
        <SectionEyebrow title="Onboarding" margin="none" />
        <p className="text-xs text-neutral-500 mt-0.5">
          Every code is single-use (one code, one analyst), so each row tracks
          one analyst&apos;s journey: archives imported, bot detections, live
          detections, geolocations, last seen. Mint, share via a trusted channel,
          then manage the code and the account from the row. Minted by names the
          analyst who minted a code from Settings.
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

      {(error ?? loadError) && (
        <div className={FORM_ERROR_BANNER}>{error ?? loadError}</div>
      )}

      {/* `relative` holds the headers' absolute `sr-only` labels inside the scroll box, which
          otherwise widen the page on a phone. */}
      <div className="relative overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className={LABEL_TEXT}>
              <th className="py-2 pr-3 font-medium">Code</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">Minted by</th>
              <th className="py-2 pr-3 font-medium">Used by</th>
              <th className="py-2 pr-3 font-medium">X handle</th>
              <StatHeader icon={FileArchive} label="Archives imported" />
              <StatHeader icon={AtSign} label="Bot detections" />
              <StatHeader icon={Bot} label="Detections" />
              <StatHeader icon={MapPin} label="Geolocations" />
              <th className="py-2 pr-3 font-medium">Last seen</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
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
                  onToggle={() => {
                    setOutcome(null);
                    setExpandedId((prev) => (prev === c.id ? null : c.id));
                  }}
                  // A mint, revoke or delete changes what the first page holds: restart the walk
                  // rather than patch a page it may have left.
                  onRevoked={reload}
                  onDeleted={() => {
                    setExpandedId((prev) => (prev === c.id ? null : prev));
                    reload();
                  }}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <LoadMoreRow walk={walk} />

      {managed && (
        <UserActionsCard
          // Keyed by user so form drafts and an armed danger confirm never survive a switch between analysts.
          key={managed.user_id}
          user={{
            id: managed.user_id,
            username: managed.username,
            email: managed.email,
            is_admin: managed.is_admin,
            x_handle: managed.x_handle,
            is_invite_minting_enabled: managed.is_invite_minting_enabled,
            sponsor: managedCode?.sponsor ?? null,
            deleted_at: managed.deleted_at,
          }}
          detectedCount={managed.detected_count}
          onUpdated={reload}
          onOutcome={onOutcome}
        />
      )}

      {outcome && <UserOutcomeReceipt outcome={outcome} />}
    </Card>
  );
}
