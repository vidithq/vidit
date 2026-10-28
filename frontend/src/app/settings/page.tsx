"use client";

import { useState } from "react";
import { Check } from "lucide-react";
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
  FORM_LABEL,
  FORM_SUCCESS_BANNER,
} from "@/components/ui/form-styles";
import { Input } from "@/components/ui/Input";
import { META_LINE } from "@/components/ui/styles";
import { PreferenceText, ToggleRow } from "@/components/ui/ToggleRow";
import type { Concept } from "@/lib/fieldHelp";
import { useFlash } from "@/hooks/useFlash";
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
import { ErrorNotice } from "@/components/ui/ErrorNotice";

const SAVE_FAILED = "Could not save to your account. Try again.";

/** One Email switch per registered kind. The backend drops a value equal to the default, so a
 *  switch moved back stores nothing. */
function NotificationsCard() {
  const { data, error } = useApiResource<UserPreferences>(PREFERENCES_PATH);
  const [saved, setSaved] = useState<UserPreferences | null>(null);
  const confirm = useFlash();
  const onSuccess = (prefs: UserPreferences) => {
    setSaved(prefs);
    confirm.flash();
  };
  const toggle = useMutation(
    (kind: NotificationKind, on: boolean) => updatePreferences({ notifications: { [kind]: on } }),
    { fallback: SAVE_FAILED, onSuccess }
  );
  const audience = useMutation(
    (value: ApprovalRequestAudience) => updatePreferences({ approval_request_audience: value }),
    { fallback: SAVE_FAILED, onSuccess }
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
      <SettingsHeading title="Notifications" concept="notification_settings" saved={confirm.on} />
      {(error || toggle.error || audience.error) && (
        <ErrorNotice error={toggle.error ?? audience.error ?? error} />
      )}
      <ChoiceRow
        label="Accept approval requests from"
        concept="approval_request_audience"
        options={APPROVAL_REQUEST_AUDIENCE_OPTIONS}
        value={currentAudience}
        onChange={(value) => void audience.run(value)}
      />
      {rows.map((row) => (
        <ToggleRow
          key={row.kind}
          label={NOTIFICATION_KIND_COPY[row.kind].label}
          concept={`notification_${row.kind}`}
          variant="setting"
          on={row.email}
          onToggle={() => void toggle.run(row.kind, !row.email)}
          className="border-t border-neutral-800 pt-4"
        />
      ))}
    </Card>
  );
}

/** A card's heading and its `?`, with *Saved* beside it for a moment after one of its settings
 *  reaches the account. */
function SettingsHeading({
  title,
  concept,
  saved,
}: {
  title: string;
  concept: Concept;
  saved: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <SectionEyebrow title={title} concept={concept} margin="none" />
      <span role="status" className={META_LINE}>
        {saved && (
          <>
            <Check size={12} aria-hidden />
            Saved
          </>
        )}
      </span>
    </div>
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
  const displaySaved = useFlash();
  const display = useMutation(
    (change: Parameters<typeof saveDisplay>[1]) =>
      user ? saveDisplay(user.id, change) : Promise.resolve(undefined),
    { fallback: SAVE_FAILED, onSuccess: displaySaved.flash }
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
          <SettingsHeading title="Display" concept="display_settings" saved={displaySaved.on} />
          {display.error && (
            <ErrorNotice error={display.error} />
          )}
          {/* `<ToggleRow>` makes the whole row the switch, so a thumb on the label still toggles. The divider is this card's. */}
          <ToggleRow
            label="Show help tooltips"
            concept="help_tooltips"
            variant="setting"
            on={!helpHidden}
            onToggle={() => display.run({ help_tooltips: helpHidden })}
          />

          <ToggleRow
            label="Light mode"
            concept="light_mode"
            variant="setting"
            on={theme === "light"}
            onToggle={() => display.run({ theme: theme === "light" ? "dark" : "light" })}
            className="border-t border-neutral-800 pt-4"
          />

          {/* Stacks below `sm`: five 36px controls take 212px, leaving the label no room at 320px. */}
          <div className="flex max-sm:flex-col max-sm:items-start items-center justify-between gap-4 border-t border-neutral-800 pt-4">
            <PreferenceText label="Accent color" concept="accent_color" />
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
          <SectionEyebrow title="Change password" margin="none" />

          <form onSubmit={handleSubmit} noValidate className="space-y-3">
            <IncompleteFormAnnouncer
              attempt={incomplete.validationAttempt}
              missing={incomplete.missingFields.map((m) => m.label)}
            />
            {error && (
              <ErrorNotice error={error} />
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
