"use client";

import { useState } from "react";
import { Copy } from "lucide-react";

import { useApiResource } from "@/hooks/useApiResource";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { useMutation } from "@/hooks/useMutation";
import { formatDate, formatInstant } from "@/lib/format";
import {
  MY_INVITE_CODES_PATH,
  mintInviteCode,
  type SponsoredInviteCode,
  type SponsoredInviteCodeList,
} from "@/lib/inviteCodes";
import { InviteStatusPill } from "@/components/invites/InviteStatusPill";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CopyButton";
import { Input } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER, FORM_LABEL, LIST_TILE } from "@/components/ui/form-styles";

function CopyLink({ code }: { code: SponsoredInviteCode }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <CopyButton
      label={`Copy the invite link for @${code.x_handle}`}
      announce="Link copied"
      icon={<Copy size={14} />}
      copied={copied}
      onClick={() => void copy(code.link)}
    />
  );
}

/** Invite an analyst: mint a single-use code bound to their X handle, which copies the register
 *  link, and follow every code you minted. The mint form shows only while an admin leaves minting on. */
export function InviteAnalystsCard() {
  const { data, error, refetch } = useApiResource<SponsoredInviteCodeList>(MY_INVITE_CODES_PATH);
  const [handle, setHandle] = useState("");
  const [lastMint, setLastMint] = useState<{ handle: string; copied: boolean } | null>(null);
  const { copy } = useCopyToClipboard();

  const mint = useMutation(() => mintInviteCode(handle.trim()), {
    fallback: "Could not mint the invite code. Try again.",
    onSuccess: async (code) => {
      setHandle("");
      refetch();
      // A browser refuses the write once the click's user activation expires (Safari after the
      // fetch), so the status line then points to the row's copy button.
      setLastMint({ handle: code.x_handle, copied: await copy(code.link) });
    },
  });

  const codes = Array.isArray(data?.items) ? data.items : [];
  const mintingEnabled = data?.minting_enabled === true;
  if (data && !mintingEnabled && codes.length === 0) return null;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLastMint(null);
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

      {(error || mint.error) && <div className={FORM_ERROR_BANNER}>{mint.error ?? error}</div>}

      {mintingEnabled && data && (
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label htmlFor="invite-x-handle" className={FORM_LABEL}>
              Invitee&apos;s X handle
            </label>
            <Input
              id="invite-x-handle"
              required
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
          {lastMint && (
            <p className="text-xs text-neutral-400" role="status">
              {lastMint.copied
                ? `Invite link for @${lastMint.handle} copied to your clipboard.`
                : `Invite code for @${lastMint.handle} minted. Copy its link below.`}
            </p>
          )}
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
              {code.status === "active" && <CopyLink code={code} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
