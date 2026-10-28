"use client";

import { useRef, useState } from "react";

import { searchUsers, type AdminUser } from "@/lib/admin";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_LABEL } from "@/components/ui/form-styles";
import { AccountPicker, analystAccount } from "@/components/ui/AccountPicker";
import { Card } from "@/components/ui/Card";
import { UserOutcomeReceipt, type UserOutcome } from "@/components/admin/ActionReceipt";
import { UserActionsCard } from "@/components/admin/UserActionsCard";

export function ManageAnalystsPanel() {
  // The picker hands back an account; the action card needs the admin row it came from.
  const found = useRef(new Map<string, AdminUser>());
  const [picked, setPicked] = useState<AdminUser | null>(null);
  const [outcome, setOutcome] = useState<UserOutcome | null>(null);

  const search = async (query: string) => {
    const users = await searchUsers(query);
    for (const user of users) found.current.set(user.username, user);
    return users.map(analystAccount);
  };

  const onOutcome = (next: UserOutcome) => {
    // A deleted user is gone (hard) or out of this search (soft).
    if (next.kind === "delete") setPicked(null);
    setOutcome(next);
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
              setOutcome(null);
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
          onOutcome={onOutcome}
        />
      )}

      {outcome && <UserOutcomeReceipt outcome={outcome} />}
    </Card>
  );
}
