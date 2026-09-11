"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { PASSWORD_MIN_LENGTH, validatePasswordChange } from "@/lib/auth";
import { useMutation } from "@/hooks/useMutation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Button, ICON_TAP_STEP } from "@/components/ui/Button";
import {
  FORM_ERROR_BANNER,
  FORM_LABEL,
  FORM_SUCCESS_BANNER,
} from "@/components/ui/form-styles";
import { Input } from "@/components/ui/Input";
import { ToggleRow } from "@/components/ui/ToggleRow";
import { useHelpHidden } from "@/hooks/useHelpHidden";
import { setHelpHidden } from "@/lib/helpPreference";
import { usePalette } from "@/hooks/usePalette";
import { PALETTES, setPalette } from "@/lib/palette";
import { useTheme } from "@/hooks/useTheme";
import { setTheme } from "@/lib/theme";



export default function SettingsPage() {
  const { user, loading } = useRequireAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [success, setSuccess] = useState(false);
  const helpHidden = useHelpHidden();
  const palette = usePalette();
  const theme = useTheme();

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
          {/* One column below `sm`: at 320px two columns are about 88px each,
              and an email address is a single unbreakable token. */}
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
        </Card>

        <Card>
          <div className="space-y-1">
            <SectionEyebrow title="Display" margin="none" />
            <p className="text-xs text-neutral-500">
              Preferences stored in this browser.
            </p>
          </div>
          {/* Both preference rows are `<ToggleRow>`: the whole row carries the
              switch role and the click, so a thumb that lands on the label
              toggles rather than missing the 20x36px track. The divider between
              them is this card's, not the primitive's. */}
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
            onToggle={() => setHelpHidden(!helpHidden)}
          />

          <ToggleRow
            label="Light mode"
            description="Switch the interface and map to a light background. Dark by default."
            on={theme === "light"}
            onToggle={() => setTheme(theme === "light" ? "dark" : "light")}
            className="border-t border-neutral-800 pt-4"
          />

          {/* The swatch row stacks under its label below `sm`: five 36px
              controls and their gaps take 212px, which leaves the label
              nothing to sit in on a 320px screen. */}
          <div className="flex max-sm:flex-col max-sm:items-start items-center justify-between gap-4 border-t border-neutral-800 pt-4">
            <div>
              <p className="text-sm text-neutral-200">Accent color</p>
              <p className="text-xs text-neutral-500">
                The highlight color for buttons, links, selected states, and map
                points.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {PALETTES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={palette === p.id}
                  aria-label={p.label}
                  title={p.label}
                  onClick={() => setPalette(p.id)}
                  style={{ backgroundColor: p.swatch }}
                  // `ICON_TAP_STEP`, the phone floor every small icon control
                  // takes: the swatch is a 24px disc on a desktop, under what a
                  // thumb reliably hits.
                  className={`${ICON_TAP_STEP} sm:size-6 rounded-full transition-transform hover:scale-110 ${
                    palette === p.id
                      ? "ring-2 ring-neutral-100 ring-offset-2 ring-offset-neutral-900"
                      : "ring-1 ring-neutral-700"
                  }`}
                />
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <div className="space-y-1">
            <SectionEyebrow title="Change password" margin="none" />
            <p className="text-xs text-neutral-500">
              Update the password used to sign in to Vidit.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
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
              <label htmlFor="current-password" className={FORM_LABEL}>
                Current password
              </label>
              <Input
                id="current-password"
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="mt-1"
              />
            </div>

            <div>
              <label htmlFor="new-password" className={FORM_LABEL}>
                New password
              </label>
              <Input
                id="new-password"
                type="password"
                required
                minLength={PASSWORD_MIN_LENGTH}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1"
              />
            </div>

            <div>
              <label htmlFor="confirm-password" className={FORM_LABEL}>
                Confirm new password
              </label>
              <Input
                id="confirm-password"
                type="password"
                required
                minLength={PASSWORD_MIN_LENGTH}
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
