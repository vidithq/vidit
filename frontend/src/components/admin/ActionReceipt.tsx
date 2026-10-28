import type { ReactNode } from "react";

import type {
  AdminPurgeDetectedResponse,
  AdminUserDeleteResponse,
  AdminUserRestoreResponse,
} from "@/lib/admin";
import { Pill } from "@/components/ui/Pill";
import { countLabel } from "@/lib/format";

/** Post-action receipt shared by the admin panels (analyst delete and restore, detection purge,
 * event moderation and delete): a quiet summary box whose badge names the action taken. An
 * irreversible or withholding action reads danger (red), the rest neutral, as the invite
 * StatusChip. */
export function ActionReceipt({
  action,
  danger = false,
  header,
  children,
}: {
  action: string;
  danger?: boolean;
  /** Inline nodes before the action badge (the username / title). */
  header: ReactNode;
  /** Detail lines under the header. */
  children?: ReactNode;
}) {
  return (
    <div className="px-3 py-2 rounded-md text-xs text-neutral-300 bg-neutral-800/60 border border-neutral-700 space-y-1">
      <div className="inline-flex items-center gap-1.5">
        {header}
        <Pill tone={danger ? "danger" : "neutral"} className="uppercase tracking-wider">
          {action}
        </Pill>
      </div>
      {children}
    </div>
  );
}

/** What an account action left: the outcome `UserActionsCard` hands its panel. */
export type UserOutcome =
  | { kind: "delete"; data: AdminUserDeleteResponse }
  | { kind: "restore"; data: AdminUserRestoreResponse }
  | { kind: "purge"; data: AdminPurgeDetectedResponse };

function outcomeSummary(outcome: UserOutcome): { action: string; danger: boolean; text: string } {
  switch (outcome.kind) {
    case "delete": {
      const { data } = outcome;
      const handed =
        data.transferred_events > 0
          ? ` Handed ${countLabel(data.transferred_events, "event")} to a co-geolocator.`
          : "";
      return data.mode === "hard"
        ? {
            action: "Hard delete",
            danger: true,
            text: `Erased the account, ${countLabel(data.cascaded_geolocations, "event")} and ${countLabel(
              data.media_count,
              "storage object",
            )}.${handed}`,
          }
        : {
            action: "Soft delete",
            danger: false,
            text: `Hid the account and ${countLabel(data.cascaded_geolocations, "event")}.${handed}`,
          };
    }
    case "restore":
      return {
        action: "Restored",
        danger: false,
        text: `Restored the account and ${countLabel(
          outcome.data.restored_events,
          "event",
        )}. Link its X handle again if it had one.`,
      };
    case "purge":
      return {
        action: "Purge",
        danger: true,
        text: `Purged ${countLabel(outcome.data.deleted_events, "detection")}, swept ${countLabel(
          outcome.data.media_count,
          "storage object",
        )}. Account untouched.`,
      };
  }
}

/** The receipt of an account action, shared by the onboarding table and Manage-analysts search so
 * the copy can't drift (like `UserActionsCard`). */
export function UserOutcomeReceipt({ outcome }: { outcome: UserOutcome }) {
  const { action, danger, text } = outcomeSummary(outcome);
  return (
    <ActionReceipt
      action={action}
      danger={danger}
      header={<span className="font-medium">{outcome.data.username}</span>}
    >
      <div className="text-neutral-500">{text}</div>
    </ActionReceipt>
  );
}
