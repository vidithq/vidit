"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { PageCenter, PageShell } from "@/components/ui/PageShell";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import {
  FORM_ERROR_BANNER_COMPACT,
  FORM_INPUT,
  FORM_LABEL,
} from "@/components/ui/form-styles";



export default function SettingsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <PageCenter>
        <span className="text-neutral-500">Loading...</span>
      </PageCenter>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password change failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageShell title="Settings">

        <div className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-3">
          <h2 className="text-sm font-medium text-neutral-300">Account</h2>
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
        </div>

        <div className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-4">
          <div className="space-y-1">
            <h2 className="text-sm font-medium text-neutral-300">Change password</h2>
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
              // Success banners reuse the orange-tinted shape from
              // LoginForm's "reset successful" banner. Emerald is
              // deliberately out — design.md's palette recipe explains why: "success"
              // celebrations next to red destructive actions read wrong,
              // and the rest of the app stays in the orange family.
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
                minLength={8}
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
                minLength={8}
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
        </div>
    </PageShell>
  );
}
