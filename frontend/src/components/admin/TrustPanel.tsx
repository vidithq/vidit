"use client";

import { useState } from "react";
import { Search } from "lucide-react";

import {
  searchUsers,
  type AdminPurgeDetectedResponse,
  type AdminUser,
  type AdminUserDeleteResponse,
} from "@/lib/admin";
import { useMutation } from "@/hooks/useMutation";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER, FORM_LABEL } from "@/components/ui/form-styles";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { ActionReceipt } from "@/components/admin/ActionReceipt";
import { UserActionsCard } from "@/components/admin/UserActionsCard";

export function TrustPanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminUser[] | null>(null);
  const [lastDelete, setLastDelete] = useState<AdminUserDeleteResponse | null>(
    null
  );
  const [lastPurge, setLastPurge] = useState<AdminPurgeDetectedResponse | null>(
    null
  );

  const searchMutation = useMutation(() => searchUsers(query), {
    fallback: "Search failed",
    onSuccess: setResults,
  });
  const searching = searchMutation.loading;
  const error = searchMutation.error;

  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setLastDelete(null);
    setLastPurge(null);
    await searchMutation.run();
  };

  const onUpdated = (u: AdminUser) => {
    setResults((prev) =>
      prev ? prev.map((row) => (row.id === u.id ? u : row)) : prev
    );
  };

  const onDeleted = (userId: string, response: AdminUserDeleteResponse) => {
    // Drop the row: the user is now gone (hard) or hidden from reads (soft).
    setResults((prev) => (prev ? prev.filter((r) => r.id !== userId) : prev));
    setLastDelete(response);
  };

  return (
    <Card as="section">
      <header>
        <SectionEyebrow title="Manage analysts" margin="none" />
        <p className="text-xs text-neutral-500 mt-0.5">
          Find any analyst by username or email, including accounts that never
          came through an invite code, then act on the row: the same actions as
          the onboarding table above.
        </p>
      </header>

      <form
        onSubmit={onSearch}
        className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end"
      >
        <div>
          <label className={FORM_LABEL} htmlFor="user-search">
            Find an analyst (username or email)
          </label>
          <Input
            variant="compact"
            id="user-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="username or email"
            className="mt-1"
          />
        </div>
        <Button
          type="submit"
          variant="secondary"
          disabled={searching || !query.trim()}
        >
          <Search size={12} />
          {searching ? "Searching…" : "Search"}
        </Button>
      </form>

      {error && (
        <div className={FORM_ERROR_BANNER}>
          {error}
        </div>
      )}

      {results !== null && (
        <div className="space-y-2">
          {results.length === 0 ? (
            <div className="text-xs text-neutral-500 py-2">
              No analysts match.
            </div>
          ) : (
            results.map((u) => (
              <UserActionsCard
                key={u.id}
                user={u}
                onUpdated={onUpdated}
                onDeleted={onDeleted}
                onPurged={setLastPurge}
              />
            ))
          )}
        </div>
      )}

      {lastDelete && (
        <ActionReceipt
          mode={lastDelete.mode}
          header={<span className="font-medium">@{lastDelete.username}</span>}
        >
          <div className="text-neutral-500">
            {lastDelete.mode === "hard"
              ? `Dropped ${lastDelete.cascaded_geolocations} geolocation${
                  lastDelete.cascaded_geolocations === 1 ? "" : "s"
                }, swept ${lastDelete.media_count} media row${
                  lastDelete.media_count === 1 ? "" : "s"
                } (source + proof roles).`
              : `Cascade-hid ${lastDelete.cascaded_geolocations} geolocation${
                  lastDelete.cascaded_geolocations === 1 ? "" : "s"
                }.`}
          </div>
        </ActionReceipt>
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
