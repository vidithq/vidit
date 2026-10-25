"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { PASSWORD_MAX_BYTES, validatePasswordChange } from "@/lib/auth";
import { useMutation } from "@/hooks/useMutation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { AccountXHandle } from "@/components/settings/AccountXHandle";
import { InviteAnalystsCard } from "@/components/settings/InviteAnalystsCard";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Button } from "@/components/ui/Button";
import { ChoiceRow } from "@/components/ui/ChoiceRow";
import { IncompleteFormAnnouncer } from "@/components/ui/IncompleteFormAnnouncer";
import {
  FORM_ERROR_BANNER,
  FORM_LABEL,
  FORM_SUCCESS_BANNER,
} from "@/components/ui/form-styles";
import { Input } from "@/components/ui/Input";
import { ToggleRow } from "@/components/ui/ToggleRow";
import { blankFields, useIncompleteForm } from "@/hooks/useIncompleteForm";
import { useHelpHidden } from "@/hooks/useHelpHidden";
import { usePalette } from "@/hooks/usePalette";
import { PALETTES } from "@/lib/palette";
import { useTheme } from "@/hooks/useTheme";
import { useApiResource } from "@/hooks/useApiResource";
import { NOTIFICATION_KIND_COPY, type NotificationKind } from "@/lib/notifications";
import {
  APPROVAL_REQUEST_AUDIENCE_DEFAULT,
  APPROVAL_REQUEST_AUDIENCE_OPTIONS,
  type ApprovalRequestAudience,
} from "@/lib/approvalRequests";
import { SwatchPicker } from "@/components/ui/SwatchPicker";
import {
  PREFERENCES_PATH,
  saveDisplay,
  updatePreferences,
  type UserPreferences,
} from "@/lib/preferences";

const SAVE_FAILED = "Could not save to your account. Try again.";

/** One Email switch per registered kind. The backend drops a value equal to the default, so a
 *  switch moved back stores nothing. */
function NotificationsCard() {
  const { data, error } = useApiResource<UserPreferences>(PREFERENCES_PATH);
  const [saved, setSaved] = useState<UserPreferences | null>(null);
  const toggle = useMutation(
    (kind: NotificationKind, on: boolean) => updatePreferences({ notifications: { [kind]: on } }),
    { fallback: SAVE_FAILED, onSuccess: (prefs) => setSaved(prefs) }
  );
  const audience = useMutation(
    (value: ApprovalRequestAudience) => updatePreferences({ approval_request_audience: value }),
    { fallback: SAVE_FAILED, onSuccess: (prefs) => setSaved(prefs) }
  );
  const currentAudience =
    (saved ?? data)?.approval_request_audience ?? APPROVAL_REQUEST_AUDIENCE_DEFAULT;
  // Tolerates a missing or partial payload, and a kind this build has no wording for.
  const notifications = (saved ?? data)?.notifications;
  const rows = (Array.isArray(notifications) ? notifications : []).filter(
    (row) => row.kind in NOTIFICATION_KIND_COPY
  );

  return (
    <Card>
      <div className="space-y-1">
        <SectionEyebrow title="Notifications" margin="none" />
        <p className="text-xs text-neutral-500">
          Every notification appears in your Notifications feed. The switches below choose
          which kinds Vidit also sends to your email address.
        </p>
      </div>
      {(error || toggle.error || audience.error) && (
        <div className={FORM_ERROR_BANNER}>{toggle.error ?? audience.error ?? error}</div>
      )}
      <ChoiceRow
        label="Accept approval requests from"
        description="Who can ask you to approve their geolocation."
        options={APPROVAL_REQUEST_AUDIENCE_OPTIONS}
        value={currentAudience}
        onChange={(value) => void audience.run(value)}
      />
      {rows.map((row) => {
        const copy = NOTIFICATION_KIND_COPY[row.kind];
        return (
          <ToggleRow
            key={row.kind}
            label={copy.label}
            description={`${copy.setting} Default: ${row.default ? "on" : "off"}.`}
            on={row.email}
            onToggle={() => void toggle.run(row.kind, !row.email)}
            className="border-t border-neutral-800 pt-4"
          />
        );
      })}
    </Card>
  );
}

export default function SettingsPage() {
  const { user, loading } = useRequireAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [success, setSuccess] = useState(false);
  const incomplete = useIncompleteForm<"current" | "new" | "confirm">();
  const { invalidKeys } = incomplete;
  const helpHidden = useHelpHidden();
  const palette = usePalette();
  const theme = useTheme();
  const display = useMutation(
    (change: Parameters<typeof saveDisplay>[1]) =>
      user ? saveDisplay(user.id, change) : Promise.resolve(undefined),
    { fallback: SAVE_FAILED }
  );

  const changePassword = useMutation(
    () =>
      apiFetch("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      }),
    {
      fallback: "Password change failed.",
      onSuccess: () => {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setSuccess(true);
      },
    }
  );
  const { error, setError } = changePassword;
  const submitting = changePassword.loading;

  if (loading || !user) {
    return <PageLoading />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const missing = blankFields([
      { key: "current", label: "Current password", value: currentPassword },
      { key: "new", label: "New password", value: newPassword },
      { key: "confirm", label: "Confirm new password", value: confirmPassword },
    ]);
    if (missing.length) {
      incomplete.flagIncomplete(missing);
      return;
    }
    incomplete.clearIncomplete();

    const validationError = validatePasswordChange(newPassword, confirmPassword);
    if (validationError) {
      setError(validationError);
      return;
    }

    await changePassword.run();
  };

  return (
    <PageShell title="Settings">

        <Card>
          <SectionEyebrow title="Account" margin="none" />
          {/* One column below `sm`: an email address is an unbreakable token. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <span className={FORM_LABEL}>Username</span>
              <p className="text-neutral-100 mt-0.5">{user.username}</p>
            </div>
            <div>
              <span className={FORM_LABEL}>Email</span>
              <p className="text-neutral-100 mt-0.5 wrap-anywhere">
                {user.email}
              </p>
            </div>
          </div>
          <AccountXHandle />
        </Card>

        <InviteAnalystsCard />

        <Card>
          <div className="space-y-1">
            <SectionEyebrow title="Display" margin="none" />
            <p className="text-xs text-neutral-500">
              Saved to your account and applied wherever you sign in.
            </p>
          </div>
          {display.error && (
            <div className={FORM_ERROR_BANNER}>{display.error}</div>
          )}
          {/* `<ToggleRow>` makes the whole row the switch, so a thumb on the label still toggles. The divider is this card's. */}
          <ToggleRow
            label="Show help tooltips"
            description={
              <>
                The small <span className="font-medium">?</span> icons that
                explain each field and section. Turn them off once you know the
                form.
              </>
            }
            on={!helpHidden}
            onToggle={() => display.run({ help_tooltips: helpHidden })}
          />

          <ToggleRow
            label="Light mode"
            description="Switch the interface and map to a light background. Dark by default."
            on={theme === "light"}
            onToggle={() => display.run({ theme: theme === "light" ? "dark" : "light" })}
            className="border-t border-neutral-800 pt-4"
          />

          {/* Stacks below `sm`: five 36px controls take 212px, leaving the label no room at 320px. */}
          <div className="flex max-sm:flex-col max-sm:items-start items-center justify-between gap-4 border-t border-neutral-800 pt-4">
            <div>
              <p className="text-sm text-neutral-200">Accent color</p>
              <p className="text-xs text-neutral-500">
                The highlight color for buttons, links, selected states, and map
                points.
              </p>
            </div>
            <SwatchPicker
              aria-label="Accent color"
              options={PALETTES.map((p) => ({ value: p.id, label: p.label, color: p.swatch }))}
              value={palette}
              onChange={(id) => display.run({ palette: id })}
            />
          </div>
        </Card>

        <NotificationsCard />

        <Card>
          <div className="space-y-1">
            <SectionEyebrow title="Change password" margin="none" />
            <p className="text-xs text-neutral-500">
              Update the password used to sign in to Vidit.
            </p>
          </div>

          <form onSubmit={handleSubmit} noValidate className="space-y-3">
            <IncompleteFormAnnouncer
              attempt={incomplete.validationAttempt}
              missing={incomplete.missingFields.map((m) => m.label)}
            />
            {error && (
              <div className={FORM_ERROR_BANNER}>
                {error}
              </div>
            )}
            {success && (
              <div className={FORM_SUCCESS_BANNER}>
                Password updated.
              </div>
            )}

            <div>
              <label
                htmlFor="current-password"
                className={incomplete.labelClass("current", FORM_LABEL)}
              >
                Current password
              </label>
              <Input
                id="current-password"
                invalid={invalidKeys.has("current")}
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="mt-1"
              />
            </div>

            <div>
              <label
                htmlFor="new-password"
                className={incomplete.labelClass("new", FORM_LABEL)}
              >
                New password
              </label>
              <Input
                id="new-password"
                invalid={invalidKeys.has("new")}
                type="password"
                maxLength={PASSWORD_MAX_BYTES}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1"
              />
            </div>

            <div>
              <label
                htmlFor="confirm-password"
                className={incomplete.labelClass("confirm", FORM_LABEL)}
              >
                Confirm new password
              </label>
              <Input
                id="confirm-password"
                invalid={invalidKeys.has("confirm")}
                type="password"
                maxLength={PASSWORD_MAX_BYTES}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1"
              />
            </div>

            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? "Updating..." : "Update password"}
            </Button>
          </form>
        </Card>
    </PageShell>
  );
}
