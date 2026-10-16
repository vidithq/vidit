import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("./api", () => ({ apiFetch: api.apiFetch }));

import { disablePush, enablePush, readPushState } from "./push";

// An uncompressed P-256 point, base64url: 0x04 then 64 bytes.
const KEY = btoa(String.fromCharCode(4, ...new Array(64).fill(1)))
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/, "");
const SUBSCRIPTION_JSON = {
  endpoint: "https://fcm.googleapis.com/fcm/send/x",
  keys: { p256dh: "p", auth: "a" },
};

function fakeSubscription() {
  return { toJSON: () => SUBSCRIPTION_JSON, unsubscribe: vi.fn().mockResolvedValue(true) };
}

function installBrowser({
  permission = "default" as NotificationPermission,
  subscription = null as ReturnType<typeof fakeSubscription> | null,
  requested = "granted" as NotificationPermission,
} = {}) {
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(subscription),
    subscribe: vi.fn().mockResolvedValue(fakeSubscription()),
  };
  const registration = { pushManager };
  const serviceWorker = {
    register: vi.fn().mockResolvedValue(registration),
    ready: Promise.resolve(registration),
    getRegistration: vi.fn().mockResolvedValue(subscription ? registration : undefined),
  };
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal(
    "Notification",
    Object.assign(class {}, { permission, requestPermission: vi.fn().mockResolvedValue(requested) }),
  );
  Object.defineProperty(navigator, "serviceWorker", { value: serviceWorker, configurable: true });
  return { pushManager, serviceWorker };
}

function setUserAgent(userAgent: string, maxTouchPoints = 0) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  Object.defineProperty(navigator, "maxTouchPoints", { value: maxTouchPoints, configurable: true });
}

describe("push", () => {
  beforeEach(() => {
    api.apiFetch.mockReset().mockResolvedValue({ id: "device-1" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "serviceWorker");
    Reflect.deleteProperty(navigator, "maxTouchPoints");
  });

  it("asks an iPhone browser tab to add the site to the Home Screen", async () => {
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)");
    expect(await readPushState({ public_key: KEY })).toBe("needs-home-screen");
  });

  it("calls a desktop browser without the Push API unsupported", async () => {
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    expect(await readPushState({ public_key: KEY })).toBe("unsupported");
  });

  it("reads unavailable, denied, off and on", async () => {
    installBrowser();
    expect(await readPushState({ public_key: null })).toBe("unavailable");
    expect(await readPushState({ public_key: KEY })).toBe("off");

    installBrowser({ permission: "denied" });
    expect(await readPushState({ public_key: KEY })).toBe("denied");

    installBrowser({ permission: "granted" });
    expect(await readPushState({ public_key: KEY })).toBe("off");

    installBrowser({ permission: "granted", subscription: fakeSubscription() });
    expect(await readPushState({ public_key: KEY })).toBe("on");
  });

  it("enables: permission, service worker, subscription, then the server row", async () => {
    const { pushManager, serviceWorker } = installBrowser();

    expect(await enablePush(KEY)).toBe("on");

    expect(serviceWorker.register).toHaveBeenCalledWith("/sw.js");
    const [options] = pushManager.subscribe.mock.calls[0];
    expect(options.userVisibleOnly).toBe(true);
    expect(options.applicationServerKey).toHaveLength(65);
    expect(options.applicationServerKey[0]).toBe(4);
    expect(api.apiFetch).toHaveBeenCalledWith("/users/me/push-subscriptions", {
      method: "POST",
      body: JSON.stringify(SUBSCRIPTION_JSON),
    });
  });

  it("stops before subscribing when the permission is refused", async () => {
    const { pushManager } = installBrowser({ requested: "denied" });
    expect(await enablePush(KEY)).toBe("denied");
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(api.apiFetch).not.toHaveBeenCalled();
  });

  it("disables: deletes the server row by the id a re-registration returns", async () => {
    const subscription = fakeSubscription();
    installBrowser({ permission: "granted", subscription });

    expect(await disablePush()).toBe("off");

    expect(api.apiFetch).toHaveBeenLastCalledWith("/users/me/push-subscriptions/device-1", {
      method: "DELETE",
    });
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });
});
