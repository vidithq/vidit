"use client";

import { useState } from "react";
import { Copy, Trash2 } from "lucide-react";

import { useApiResource } from "@/hooks/useApiResource";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { useMutation } from "@/hooks/useMutation";
import { formatDate, formatInstant } from "@/lib/format";
import {
  MY_INVITE_CODES_PATH,
  mintInviteCode,
  revokeInviteCode,
  type SponsoredInviteCode,
  type SponsoredInviteCodeList,
} from "@/lib/inviteCodes";
import { InviteStatusPill } from "@/components/invites/InviteStatusPill";
import { Button, DANGER_CONFIRM } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CopyButton";
import { IncompleteFormNotice } from "@/components/ui/IncompleteFormNotice";
import { Input } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import {
  FORM_ERROR_BANNER,
  FORM_LABEL,
  LIST_TILE,
} from "@/components/ui/form-styles";
import { blankFields, useIncompleteForm } from "@/hooks/useIncompleteForm";

/** `copiedOnMint` holds while the mint's own copy of this link flashes. */
function CopyLink({ code, copiedOnMint }: { code: SponsoredInviteCode; copiedOnMint: boolean }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <CopyButton
      label={`Copy the invite link for @${code.x_handle}`}
      announce="Link copied"
      icon={<Copy size={14} />}
      copied={copied || copiedOnMint}
      onClick={() => void copy(code.link)}
    />
  );
}

function RevokeCode({
  code,
  disabled,
  onRevoke,
}: {
  code: SponsoredInviteCode;
  disabled: boolean;
  onRevoke: (id: string) => void;
}) {
  const { armed, trigger, controlRef } = useConfirmAction(() => onRevoke(code.id), {
    timeoutMs: 4000,
    dismissOnOutside: true,
  });
  const label = armed
    ? `Confirm revoking the invite code for @${code.x_handle}`
    : `Revoke the invite code for @${code.x_handle}`;
  return (
    <Button
      ref={controlRef}
      icon
      variant="ghost"
      disabled={disabled}
      onClick={trigger}
      className={armed ? DANGER_CONFIRM : ""}
      aria-label={label}
      title={label}
    >
      <Trash2 size={14} />
    </Button>
  );
}

/** Invite an analyst: mint a single-use code bound to their X handle, which copies the register
 *  link, follow every code you minted, and revoke an active one. The mint form shows only while an
 *  admin leaves minting on. */
export function InviteAnalystsCard() {
  const { data, error, refetch } = useApiResource<SponsoredInviteCodeList>(MY_INVITE_CODES_PATH);
  const [handle, setHandle] = useState("");
  // Shown at the top of the list until the refetch returns it, so its copy flash is visible.
  const [minted, setMinted] = useState<SponsoredInviteCode | null>(null);
  const mintCopy = useCopyToClipboard();
  const incomplete = useIncompleteForm<"handle">();

  const mint = useMutation(() => mintInviteCode(handle.trim()), {
    fallback: "Could not mint the invite code. Try again.",
    onSuccess: async (code) => {
      setHandle("");
      setMinted(code);
      refetch();
      // Copy here, not after the refetch: a browser refuses the write once the click's user
      // activation expires. A refused write leaves the row's copy button as the way to copy.
      await mintCopy.copy(code.link);
    },
  });

  const revoke = useMutation((id: string) => revokeInviteCode(id), {
    fallback: "Could not revoke the invite code. Try again.",
    onSuccess: () => refetch(),
  });

  const fetched = Array.isArray(data?.items) ? data.items : [];
  const codes =
    minted && !fetched.some((code) => code.id === minted.id) ? [minted, ...fetched] : fetched;
  const mintingEnabled = data?.minting_enabled === true;
  if (data && !mintingEnabled && codes.length === 0) return null;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    revoke.reset();
    const missing = blankFields([
      { key: "handle", label: "Invitee's X handle", value: handle },
    ]);
    if (missing.length) {
      mint.reset();
      incomplete.flagIncomplete(missing);
      return;
    }
    incomplete.clearIncomplete();
    void mint.run();
  };

  return (
    <Card>
      <div className="space-y-1">
        <SectionEyebrow title="Invite analysts" margin="none" />
        <p className="text-xs text-neutral-500">
          Each invite code is single use and bound to the invitee&apos;s X handle, which their new
          account links on sign-up. Share the link with the analyst you invite.
        </p>
      </div>

      {(error || mint.error || revoke.error) && (
        <div className={FORM_ERROR_BANNER}>{mint.error ?? revoke.error ?? error}</div>
      )}

      {mintingEnabled && data && (
        <form onSubmit={onSubmit} noValidate className="space-y-3">
          <IncompleteFormNotice
            key={incomplete.validationAttempt}
            missing={incomplete.missingFields.map((m) => m.label)}
          />
          <div>
            <label
              htmlFor="invite-x-handle"
              className={incomplete.labelClass("handle", FORM_LABEL)}
            >
              Invitee&apos;s X handle
            </label>
            <Input
              id="invite-x-handle"
              invalid={incomplete.invalidKeys.has("handle")}
              autoComplete="off"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="@handle"
              className="mt-1"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" disabled={mint.loading}>
              {mint.loading ? "Minting…" : "Mint invite code"}
            </Button>
            <p className="text-xs text-neutral-500">
              {Math.max(0, data.daily_limit - data.minted_today)} of {data.daily_limit} left today.
              The quota resets on {formatInstant(data.resets_at)}.
            </p>
          </div>
        </form>
      )}

      {codes.length > 0 && (
        <ul className="space-y-2">
          {codes.map((code) => (
            <li key={code.id} className={`${LIST_TILE} flex flex-wrap items-center gap-2`}>
              <Pill>@{code.x_handle}</Pill>
              <InviteStatusPill status={code.status} usedAt={code.used_at} />
              <span className="text-xs text-neutral-500 flex-1">
                Minted {formatDate(code.created_at)}
              </span>
              {code.status === "active" && (
                <>
                  <CopyLink
                    code={code}
                    copiedOnMint={mintCopy.copied && code.id === minted?.id}
                  />
                  <RevokeCode
                    code={code}
                    disabled={revoke.loading}
                    onRevoke={(id) => {
                      mint.reset();
                      void revoke.run(id);
                    }}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
