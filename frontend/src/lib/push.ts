/**
 * Web Push on this device: the browser permission, the push-only service worker (`public/sw.js`)
 * and the subscription the backend stores (`/users/me/push-subscriptions`).
 */

import { apiFetch } from "./api";
import type { components } from "./api-types";

export type PushConfig = components["schemas"]["PushConfigRead"];
export type PushDevice = components["schemas"]["PushSubscriptionRead"];

export const PUSH_CONFIG_PATH = "/users/me/push-config";
/** The account's registered devices, newest first. */
export const PUSH_DEVICES_PATH = "/users/me/push-subscriptions";
const SERVICE_WORKER_URL = "/sw.js";

/** `needs-home-screen`: an iPhone or iPad browser tab, where push exists only for the site
 *  added to the Home Screen. `unavailable`: this deployment sends no push. */
export type PushDeviceState =
  | "unsupported"
  | "needs-home-screen"
  | "unavailable"
  | "denied"
  | "off"
  | "on";

function isAppleMobile(): boolean {
  const { userAgent, maxTouchPoints } = navigator;
  // iPadOS reports a Mac user agent; the touch screen gives it away.
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

function isSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL);
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** What this device can do now, given the server's push config (`PUSH_CONFIG_PATH`). */
export async function readPushState(config: PushConfig | undefined): Promise<PushDeviceState> {
  if (!isSupported()) return isAppleMobile() ? "needs-home-screen" : "unsupported";
  if (!config?.public_key) return "unavailable";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  return (await currentSubscription()) ? "on" : "off";
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function register(subscription: PushSubscription): Promise<PushDevice> {
  return apiFetch<PushDevice>(PUSH_DEVICES_PATH, {
    method: "POST",
    body: JSON.stringify(subscription.toJSON()),
  });
}

/** Ask the permission, install the service worker, subscribe and store the device. */
export async function enablePush(publicKey: string): Promise<PushDeviceState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  await navigator.serviceWorker.register(SERVICE_WORKER_URL);
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  await register(subscription);
  return "on";
}

/** Stop pushes to one of the account's devices. */
export function revokePushDevice(id: string): Promise<void> {
  return apiFetch<void>(`${PUSH_DEVICES_PATH}/${id}`, { method: "DELETE" });
}

/** This browser's device id, or null when it holds no subscription. Registering again returns
 *  the id, since the API never echoes the endpoint. */
export async function thisPushDeviceId(): Promise<string | null> {
  if (!isSupported()) return null;
  const subscription = await currentSubscription();
  return subscription ? (await register(subscription)).id : null;
}

/** Forget this device on the server, then drop the browser subscription. */
export async function disablePush(): Promise<PushDeviceState> {
  const subscription = await currentSubscription();
  if (subscription) {
    const { id } = await register(subscription);
    await revokePushDevice(id);
    await subscription.unsubscribe();
  }
  return "off";
}

/** At sign-out, while the session still holds: forget this device, so this browser receives
 *  none of the leaving account's pushes. Never throws. */
export async function forgetThisPushDevice(): Promise<void> {
  try {
    if (isSupported()) await disablePush();
  } catch {
    // Sign-out goes on; the device stays listed in Settings, where another session revokes it.
  }
}
