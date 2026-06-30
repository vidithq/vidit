"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { PASSWORD_MIN_LENGTH, validatePasswordChange } from "@/lib/auth";
import { useMutation } from "@/hooks/useMutation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import {
  FORM_ERROR_BANNER_COMPACT,
  FORM_INPUT,
  FORM_LABEL,
} from "@/components/ui/form-styles";
import { useHelpHidden } from "@/hooks/useHelpHidden";
import { setHelpHidden } from "@/lib/helpPreference";
import { usePalette } from "@/hooks/usePalette";
import { PALETTES, setPalette } from "@/lib/palette";



export default function SettingsPage() {
  const { user, loading } = useRequireAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [success, setSuccess] = useState(false);
  const helpHidden = useHelpHidden();
  const palette = usePalette();

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

        <Card spacing="3">
          <SectionEyebrow title="Account" margin="none" />
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className={FORM_LABEL}>Username</span>
              <p className="text-neutral-100 mt-0.5">{user.username}</p>
            </div>
            <div>
              <span className={FORM_LABEL}>Email</span>
              <p className="text-neutral-100 mt-0.5">{user.email}</p>
            </div>
          </div>
        </Card>

        <Card spacing="3">
          <div className="space-y-1">
            <SectionEyebrow title="Display" margin="none" />
            <p className="text-xs text-neutral-500">
              Preferences stored in this browser.
            </p>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-neutral-200">Show help tooltips</p>
              <p className="text-xs text-neutral-500">
                The small <span className="font-medium">?</span> icons that
                explain each field and section. Turn them off once you know the
                form.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!helpHidden}
              aria-label="Show help tooltips"
              onClick={() => setHelpHidden(!helpHidden)}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                helpHidden ? "bg-neutral-700" : "bg-orange-500/60"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-neutral-100 transition-transform ${
                  helpHidden ? "translate-x-0.5" : "translate-x-[18px]"
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-neutral-800 pt-4">
            <div>
              <p className="text-sm text-neutral-200">Accent color</p>
              <p className="text-xs text-neutral-500">
                The highlight color for buttons, links, selected states, and map
                points.
              </p>
            </div>
            <div className="flex gap-2">
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
                  className={`h-6 w-6 rounded-full transition-transform hover:scale-110 ${
                    palette === p.id
                      ? "ring-2 ring-neutral-100 ring-offset-2 ring-offset-neutral-900"
                      : "ring-1 ring-neutral-700"
                  }`}
                />
              ))}
            </div>
          </div>
        </Card>

        <Card spacing="4">
          <div className="space-y-1">
            <SectionEyebrow title="Change password" margin="none" />
            <p className="text-xs text-neutral-500">
              Update the password used to sign in to Vidit.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {error && (
              <div className={FORM_ERROR_BANNER_COMPACT}>
                {error}
              </div>
            )}
            {success && (
              // Orange, not emerald (see design.md's palette): "success"
              // green next to red destructive actions reads wrong, and the
              // app stays in the orange family.
              <div className="bg-orange-500/15 border border-orange-500/30 text-orange-200 px-3 py-2 rounded-sm text-xs">
                Password updated.
              </div>
            )}

            <div>
              <label htmlFor="current-password" className={FORM_LABEL}>
                Current password
              </label>
              <input
                id="current-password"
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={`mt-1 ${FORM_INPUT}`}
              />
            </div>

            <div>
              <label htmlFor="new-password" className={FORM_LABEL}>
                New password
              </label>
              <input
                id="new-password"
                type="password"
                required
                minLength={PASSWORD_MIN_LENGTH}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={`mt-1 ${FORM_INPUT}`}
              />
            </div>

            <div>
              <label htmlFor="confirm-password" className={FORM_LABEL}>
                Confirm new password
              </label>
              <input
                id="confirm-password"
                type="password"
                required
                minLength={PASSWORD_MIN_LENGTH}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`mt-1 ${FORM_INPUT}`}
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className={`px-3 py-1.5 disabled:opacity-50 rounded-md text-xs font-medium ${PRIMARY_BUTTON}`}
            >
              {submitting ? "Updating..." : "Update password"}
            </button>
          </form>
        </Card>
    </PageShell>
  );
}
