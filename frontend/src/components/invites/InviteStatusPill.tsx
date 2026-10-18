import { Pill, type PillTone } from "@/components/ui/Pill";
import type { InviteCodeStatus } from "@/lib/inviteCodes";

const STATUS_TONE: Record<InviteCodeStatus, PillTone> = {
  active: "accent",
  exhausted: "neutral",
  revoked: "danger",
  expired: "neutral",
};

/** An invite code's status pill, shared by the admin onboarding table and Settings.
 *  The wire status ranks revoked over expired over exhausted, but the pill answers "did the
 *  code serve an account", so a redeemed code reads "used" whatever happened to it later.
 *  "used", not the wire name `exhausted`, which reads as a quota that ran out. */
export function InviteStatusPill({
  status,
  usedAt,
}: {
  status: InviteCodeStatus;
  usedAt: string | null;
}) {
  const shown = usedAt !== null ? "exhausted" : status;
  return (
    <Pill tone={STATUS_TONE[shown]} className="uppercase tracking-wider">
      {shown === "exhausted" ? "used" : shown}
    </Pill>
  );
}
