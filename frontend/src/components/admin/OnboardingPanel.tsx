"use client";

import { useCallback, useState } from "react";
import {
  AtSign,
  Ban,
  Bot,
  ChevronDown,
  ChevronRight,
  Copy,
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
  type AdminPurgeDetectedResponse,
  type InviteCode,
  type InviteCodeStatus,
} from "@/lib/admin";
import { errorMessage } from "@/lib/api";
import { ARM_MS, useConfirmAction } from "@/hooks/useConfirmAction";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { useCursorList } from "@/hooks/useCursorList";
import { useMutation } from "@/hooks/useMutation";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import {
  FORM_ERROR_BANNER,
  FORM_LABEL,
  LABEL_TEXT,
} from "@/components/ui/form-styles";
import { Button, DANGER_CONFIRM } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Pill, type PillTone } from "@/components/ui/Pill";
import { PurgeReceipt } from "@/components/admin/ActionReceipt";
import { UserActionsCard } from "@/components/admin/UserActionsCard";

// Invite lifecycle mapped onto the shared pill tones: active is the accent
// draw, revoked the red end-state, exhausted / expired the quiet neutral.
const STATUS_TONE: Record<InviteCodeStatus, PillTone> = {
  active: "accent",
  exhausted: "neutral",
  revoked: "danger",
  expired: "neutral",
};

// The wire name of a spent code is `exhausted`, which reads as a quota that ran
// out; a single-use code either served its one account or it did not, so the
// column says "used". Every other status carries its own name.
const STATUS_LABEL: Partial<Record<InviteCodeStatus, string>> = {
  exhausted: "used",
};

const COLUMN_COUNT = 10;

function StatusChip({ status }: { status: InviteCodeStatus }) {
  return (
    <Pill tone={STATUS_TONE[status]} className="uppercase tracking-wider">
      {STATUS_LABEL[status] ?? status}
    </Pill>
  );
}

// Header cell for the per-analyst stat columns: the app-wide glyph stands in
// for the label (FileArchive imports, Bot detections, MapPin geolocations,
// AtSign for detections the X bot minted from mentions), which the cell keeps
// as a tooltip and for screen readers.
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

function InviteCodeRow({
  invite,
  expanded,
  onToggle,
  onRevoke,
  onDelete,
}: {
  invite: InviteCode;
  expanded: boolean;
  onToggle: () => void;
  onRevoke: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [revoking, setRevoking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  // Revoking retires a live code, so the button only stands where there is
  // something to retire.
  const canRevoke = invite.status === "active";
  const redeemer = invite.redeemer;
  // Deletion drops the row itself, which the backend allows only while no
  // account was created from the code. Same predicate here, so the button
  // stands exactly where it works.
  const canDelete = redeemer == null;

  const {
    armed: deleteArmed,
    trigger: triggerDelete,
    controlRef: deleteButtonRef,
  } = useConfirmAction(
    async () => {
      setDeleting(true);
      try {
        await onDelete(invite.id);
      } finally {
        setDeleting(false);
      }
    },
    { timeoutMs: ARM_MS, dismissOnOutside: true },
  );

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
        {/* The wire status ranks revoked > expired > exhausted (the first
            thing an admin acted on), but this column answers "did the code
            serve an account", so a redeemed code reads used whatever
            happened to its expiry date afterwards. */}
        <StatusChip
          status={invite.used_at !== null ? "exhausted" : invite.status}
        />
      </td>
      <td className="py-2 pr-3 text-xs text-neutral-400">
        {redeemer ? (
          <span
            title={
              invite.used_at
                ? new Date(invite.used_at).toLocaleString()
                : undefined
            }
          >
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
            <Ban size={12} />
            Revoke
          </Button>
        )}
        {canDelete && (
          <Button
            ref={deleteButtonRef}
            variant="danger"
            disabled={deleting}
            onClick={triggerDelete}
            className={`ml-1 ${deleteArmed ? DANGER_CONFIRM : ""}`}
            title="Drop this row. The code was never used."
          >
            <Trash2 size={12} />
            {deleteArmed ? "Confirm?" : "Delete"}
          </Button>
        )}
      </td>
    </tr>
  );
}

export function OnboardingPanel() {
  // The invite table is capped and cursor-paged like every other list, so the
  // console walks it with a Load more rather than reading it whole: asking for
  // the whole table now silently returns its first 100 rows.
  const buildPath = useCallback(
    (cursor: string | null) => inviteCodesPath(cursor),
    [],
  );
  const {
    items: codes,
    error: loadError,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    reload,
  } = useCursorList<InviteCode>(buildPath);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lastPurge, setLastPurge] = useState<AdminPurgeDetectedResponse | null>(
    null,
  );

  const [expiresInDays, setExpiresInDays] = useState<number | "">(14);
  const [xHandle, setXHandle] = useState("");

  // The mint action owns the one error slot, and revoke and delete write to it
  // via `setError` (neither has a loading state of its own, the row owns that),
  // so the panel keeps a single shared error. The loader carries its own, shown
  // in the same banner.
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
  const { error, setError } = createMutation;
  const creating = createMutation.loading;

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await createMutation.run();
  };

  const onRevoke = async (id: string) => {
    try {
      await revokeInviteCode(id);
      // A mint or a revoke changes what the first page holds, so the walk
      // restarts rather than patching a row inside a page it may have left.
      reload();
    } catch (err) {
      setError(errorMessage(err, "Failed to revoke invite code"));
    }
  };

  const onDelete = async (id: string) => {
    try {
      await deleteInviteCode(id);
      // The row is gone, so the walk restarts like it does after a mint or a
      // revoke rather than patching a page that no longer holds it.
      setExpandedId((prev) => (prev === id ? null : prev));
      reload();
    } catch (err) {
      setError(errorMessage(err, "Failed to delete invite code"));
    }
  };

  const onPurged = (response: AdminPurgeDetectedResponse) => {
    setLastPurge(response);
    reload();
  };

  // The card renders below the table (not as an expanded row) so it stays
  // put when the wide table scrolls horizontally.
  const managed = codes.find((c) => c.id === expandedId)?.redeemer ?? null;

  return (
    <Card as="section">
      <header>
        <SectionEyebrow title="Onboarding" margin="none" />
        <p className="text-xs text-neutral-500 mt-0.5">
          Every code is single-use (one code, one analyst), so each row tracks
          one analyst&apos;s journey: archives imported, bot detections, live
          detections, geolocations, last login. Mint, share via a trusted channel,
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

      {(error ?? loadError) && (
        <div className={FORM_ERROR_BANNER}>{error ?? loadError}</div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className={LABEL_TEXT}>
              <th className="py-2 pr-3 font-medium">Code</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">Used by</th>
              <th className="py-2 pr-3 font-medium">X handle</th>
              <StatHeader icon={FileArchive} label="Archives imported" />
              <StatHeader icon={AtSign} label="Bot detections" />
              <StatHeader icon={Bot} label="Detections" />
              <StatHeader icon={MapPin} label="Geolocations" />
              <th className="py-2 pr-3 font-medium">Last login</th>
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
                    setLastPurge(null);
                    setExpandedId((prev) => (prev === c.id ? null : c.id));
                  }}
                  onRevoke={onRevoke}
                  onDelete={onDelete}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}

      {managed && (
        <UserActionsCard
          // Keyed by user so form drafts and an armed danger confirm never
          // survive a switch from one analyst's Manage to another's.
          key={managed.user_id}
          user={{
            id: managed.user_id,
            username: managed.username,
            email: managed.email,
            is_admin: managed.is_admin,
            x_handle: managed.x_handle,
          }}
          detectedCount={managed.detected_count}
          onUpdated={reload}
          onDeleted={reload}
          onPurged={onPurged}
        />
      )}

      {lastPurge && <PurgeReceipt purge={lastPurge} />}
    </Card>
  );
}
