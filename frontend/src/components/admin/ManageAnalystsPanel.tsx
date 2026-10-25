"use client";

import { useRef, useState } from "react";

import {
  searchUsers,
  type AdminPurgeDetectedResponse,
  type AdminUser,
  type AdminUserDeleteResponse,
} from "@/lib/admin";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_LABEL } from "@/components/ui/form-styles";
import { AccountPicker, analystAccount } from "@/components/ui/AccountPicker";
import { Card } from "@/components/ui/Card";
import { ActionReceipt, PurgeReceipt } from "@/components/admin/ActionReceipt";
import { UserActionsCard } from "@/components/admin/UserActionsCard";
import { countLabel } from "@/lib/format";

export function ManageAnalystsPanel() {
  // The picker hands back an account; the action card needs the admin row it came from.
  const found = useRef(new Map<string, AdminUser>());
  const [picked, setPicked] = useState<AdminUser | null>(null);
  const [lastDelete, setLastDelete] = useState<AdminUserDeleteResponse | null>(
    null,
  );
  const [lastPurge, setLastPurge] = useState<AdminPurgeDetectedResponse | null>(
    null,
  );

  const search = async (query: string) => {
    const users = await searchUsers(query);
    for (const user of users) found.current.set(user.username, user);
    return users.map(analystAccount);
  };

  const onDeleted = (_userId: string, response: AdminUserDeleteResponse) => {
    // The user is now gone (hard) or hidden from reads (soft).
    setPicked(null);
    setLastDelete(response);
    setLastPurge(null);
  };

  const onPurged = (response: AdminPurgeDetectedResponse) => {
    setLastPurge(response);
    setLastDelete(null);
  };

  return (
    <Card as="section">
      <header>
        <SectionEyebrow title="Manage analysts" margin="none" />
        <p className="text-xs text-neutral-500 mt-0.5">
          Find any analyst by username or email, including accounts that never
          came through an invite code, then act on the account: the same
          actions as the onboarding table above.
        </p>
      </header>

      <div>
        <label className={FORM_LABEL} htmlFor="user-search">
          Find an analyst (username or email)
        </label>
        <div className="mt-1">
          <AccountPicker
            id="user-search"
            search={search}
            minQueryLength={1}
            selected={picked ? analystAccount(picked) : null}
            onSelect={(account) => {
              if (account.kind !== "analyst") return;
              setPicked(found.current.get(account.username) ?? null);
              setLastDelete(null);
              setLastPurge(null);
            }}
            onClear={() => setPicked(null)}
            placeholder="username or email"
            emptyText="No analysts match."
          />
        </div>
      </div>

      {picked && (
        <UserActionsCard
          // Keyed by user so form drafts never survive a switch between analysts.
          key={picked.id}
          user={picked}
          onUpdated={setPicked}
          onDeleted={onDeleted}
          onPurged={onPurged}
        />
      )}

      {lastDelete && (
        <ActionReceipt
          mode={lastDelete.mode}
          header={<span className="font-medium">{lastDelete.username}</span>}
        >
          <div className="text-neutral-500">
            {lastDelete.mode === "hard"
              ? `Dropped ${countLabel(lastDelete.cascaded_geolocations, "geolocation")}, handed ${
                  lastDelete.transferred_events
                } to a co-geolocator, swept ${countLabel(lastDelete.media_count, "media row")} (source + proof roles).`
              : `Cascade-hid ${countLabel(lastDelete.cascaded_geolocations, "geolocation")}.`}
          </div>
        </ActionReceipt>
      )}

      {lastPurge && <PurgeReceipt purge={lastPurge} />}
    </Card>
  );
}
