"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH, validatePasswordChange } from "@/lib/auth";
import { useMutation } from "@/hooks/useMutation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { AccountXHandle } from "@/components/settings/AccountXHandle";
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
import { usePalette } from "@/hooks/usePalette";
import { PALETTES } from "@/lib/palette";
import { useTheme } from "@/hooks/useTheme";
import { useApiResource } from "@/hooks/useApiResource";
import { NOTIFICATION_KIND_COPY } from "@/lib/notifications";
import { Smartphone } from "lucide-react";
import { LinkRow } from "@/components/ui/LinkRow";
import { formatDate } from "@/lib/format";
import {
  disablePush,
  enablePush,
  PUSH_CONFIG_PATH,
  PUSH_DEVICES_PATH,
  readPushState,
  revokePushDevice,
  thisPushDeviceId,
  type PushConfig,
  type PushDevice as RegisteredDevice,
  type PushDeviceState,
} from "@/lib/push";
import {
  REVIEW_REQUEST_AUDIENCE_OPTIONS,
  type ReviewRequestAudience,
} from "@/lib/reviewRequests";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import {
  PREFERENCES_PATH,
  saveDisplay,
  updatePreferences,
  type UserPreferences,
} from "@/lib/preferences";

const SAVE_FAILED = "Could not save to your account. Try again.";

type Channel = "email" | "push";

const CHANNEL_LABEL: Record<Channel, string> = { email: "by email", push: "by push" };

const PUSH_STATE_LINE: Record<PushDeviceState, string> = {
  unsupported: "This browser cannot receive push notifications.",
  "needs-home-screen": "Add Vidit to your Home Screen to receive push notifications here.",
  unavailable: "This Vidit server does not send push notifications.",
  denied:
    "Notifications are blocked for Vidit in this browser. Allow them in the site settings, then reload this page.",
  off: "Push notifications are off on this device.",
  on: "Push notifications are on for this device.",
};

/** This device's push state and the control that turns it on or off. The kind switches below
 *  it apply to every device of the account. */
function PushDevice() {
  const config = useApiResource<PushConfig>(PUSH_CONFIG_PATH);
  const [state, setState] = useState<PushDeviceState | null>(null);
  const settled = config.data !== null || config.error !== null;
  useEffect(() => {
    if (!settled) return;
    let live = true;
    readPushState(config.data ?? undefined)
      .catch((): PushDeviceState => "unsupported")
      .then((next) => {
        if (live) setState(next);
      });
    return () => {
      live = false;
    };
  }, [settled, config.data]);
  const devices = useApiResource<RegisteredDevice[]>(PUSH_DEVICES_PATH);
  const { refetch: refetchDevices } = devices;
  const [thisId, setThisId] = useState<string | null>(null);
  // Registering again names this browser's row in the list, and restores it after a password
  // change made from this signed-in device.
  useEffect(() => {
    if (state !== "on") return;
    let live = true;
    thisPushDeviceId()
      .then((id) => {
        if (!live) return;
        setThisId(id);
        refetchDevices();
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [state, refetchDevices]);
  const change = useMutation(
    (enable: boolean) =>
      enable && config.data?.public_key ? enablePush(config.data.public_key) : disablePush(),
    {
      fallback: "Could not change push on this device. Try again.",
      onSuccess: (next) => {
        setState(next);
        if (next !== "on") setThisId(null);
        refetchDevices();
      },
    }
  );
  const revoke = useMutation((id: string) => revokePushDevice(id), {
    fallback: "Could not revoke the device. Try again.",
    onSuccess: refetchDevices,
  });
  const rows = Array.isArray(devices.data) ? devices.data : [];

  return (
    <div className="space-y-2 border-t border-neutral-800 pt-4">
      <SectionEyebrow title="Push notifications" as="h3" margin="none" />
      <p className="text-xs text-neutral-500">
        {state ? PUSH_STATE_LINE[state] : "Checking this device..."} On iPhone and iPad, push
        works only after you add Vidit to the Home Screen and open it from there.
      </p>
      {(change.error || revoke.error) && (
        <div className={FORM_ERROR_BANNER}>{change.error ?? revoke.error}</div>
      )}
      {(state === "off" || state === "on") && (
        <Button
          variant={state === "off" ? "primary" : "secondary"}
          disabled={change.loading}
          onClick={() => change.run(state === "off")}
        >
          {state === "off" ? "Enable on this device" : "Turn off on this device"}
        </Button>
      )}
      {rows.map((device) => (
        <div key={device.id} className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <LinkRow
              icon={Smartphone}
              label={`${device.id === thisId ? "This device, added" : "Added"} ${formatDate(device.created_at)}`}
              value={device.user_agent ?? "Unknown browser"}
            />
          </div>
          <Button
            variant="ghost"
            disabled={revoke.loading || change.loading}
            onClick={() =>
              device.id === thisId ? change.run(false) : revoke.run(device.id)
            }
          >
            Revoke
          </Button>
        </div>
      ))}
    </div>
  );
}

/** One row per registered kind and channel, email first, then push. The backend drops an
 *  override equal to the default, so a switch moved back stores nothing. */
function NotificationsCard() {
  const { data, error } = useApiResource<UserPreferences>(PREFERENCES_PATH);
  const [saved, setSaved] = useState<UserPreferences | null>(null);
  const toggle = useMutation(
    (kind: keyof typeof NOTIFICATION_KIND_COPY, channel: Channel, on: boolean) =>
      updatePreferences({ notifications: { [kind]: { [channel]: on } } }),
    { fallback: SAVE_FAILED, onSuccess: (prefs) => setSaved(prefs) }
  );
  const consent = useMutation(
    (on: boolean) => updatePreferences({ product_updates: on }),
    { fallback: SAVE_FAILED, onSuccess: (prefs) => setSaved(prefs) }
  );
  const productUpdates = (saved ?? data)?.product_updates === true;
  const audience = useMutation(
    (value: ReviewRequestAudience) => updatePreferences({ review_request_audience: value }),
    { fallback: SAVE_FAILED, onSuccess: (prefs) => setSaved(prefs) }
  );
  const currentAudience = (saved ?? data)?.review_request_audience ?? "following";
  // Tolerates a missing or partial payload, and a kind this build has no wording for.
  const notifications = (saved ?? data)?.notifications;
  const rows = (Array.isArray(notifications) ? notifications : []).filter(
    (row) => row.kind in NOTIFICATION_KIND_COPY
  );
  const switches = (channel: Channel) =>
    rows.map((row, i) => {
      const copy = NOTIFICATION_KIND_COPY[row.kind];
      const on = row.channels?.[channel] ?? false;
      return (
        <ToggleRow
          key={`${channel}-${row.kind}`}
          label={`${copy.label} ${CHANNEL_LABEL[channel]}`}
          description={`${copy.setting} Default: ${row.defaults?.[channel] ? "on" : "off"}.`}
          on={on}
          onToggle={() => toggle.run(row.kind, channel, !on)}
          className={i > 0 ? "border-t border-neutral-800 pt-4" : ""}
        />
      );
    });

  return (
    <Card>
      <div className="space-y-1">
        <SectionEyebrow title="Notifications" margin="none" />
        <p className="text-xs text-neutral-500">
          Every notification appears in your Notifications feed. The switches below choose
          which kinds Vidit also sends to your verified email address and as push
          notifications to the devices you enable.
        </p>
      </div>
      {(error || toggle.error || consent.error || audience.error) && (
        <div className={FORM_ERROR_BANNER}>
          {toggle.error ?? consent.error ?? audience.error ?? error}
        </div>
      )}
      {/* Stacks below `sm`, where the three choices take the full column. */}
      <div className="flex max-sm:flex-col max-sm:items-stretch items-center justify-between gap-4">
        <div>
          <p className="text-sm text-neutral-200">Accept review requests from</p>
          <p className="text-xs text-neutral-500">Who can ask you to review their geolocation.</p>
        </div>
        <SegmentedControl
          aria-label="Accept review requests from"
          options={REVIEW_REQUEST_AUDIENCE_OPTIONS}
          value={currentAudience}
          onChange={(value) => void audience.run(value)}
        />
      </div>
      <SectionEyebrow title="Email" as="h3" margin="none" />
      {switches("email")}
      <ToggleRow
        label="Major release emails"
        description="One email per major Vidit release, never a patch, to your verified address. Off unless you turn it on."
        on={productUpdates}
        onToggle={() => consent.run(!productUpdates)}
        className="border-t border-neutral-800 pt-4"
      />
      <PushDevice />
      {switches("push")}
    </Card>
  );
}

export default function SettingsPage() {
  const { user, loading } = useRequireAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [success, setSuccess] = useState(false);
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
            <div className="flex flex-wrap gap-2">
              {PALETTES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={palette === p.id}
                  aria-label={p.label}
                  title={p.label}
                  onClick={() => display.run({ palette: p.id })}
                  style={{ backgroundColor: p.swatch }}
                  // `ICON_TAP_STEP`: the phone floor for small icon controls (the swatch is a 24px disc).
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

        <NotificationsCard />

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
                maxLength={PASSWORD_MAX_BYTES}
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
