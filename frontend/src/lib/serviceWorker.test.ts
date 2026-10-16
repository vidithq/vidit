import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const SOURCE = readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8");
const ORIGIN = "https://vidit.test";

type Handler = (event: Record<string, unknown>) => void;

function loadWorker({ windows = [] as { url: string }[] } = {}) {
  const handlers: Record<string, Handler> = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: Handler) => {
      handlers[type] = handler;
    },
    registration: { showNotification: vi.fn().mockResolvedValue(undefined) },
    clients: {
      matchAll: vi.fn().mockResolvedValue(windows),
      openWindow: vi.fn().mockResolvedValue(null),
    },
  };
  new Function("self", SOURCE)(self);
  return { handlers, self };
}

async function dispatch(handler: Handler, event: Record<string, unknown>) {
  let pending: Promise<unknown> = Promise.resolve();
  handler({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p) });
  await pending;
}

describe("sw.js", () => {
  it("handles push and notificationclick only: no fetch handler, no cache", () => {
    const { handlers } = loadWorker();
    expect(Object.keys(handlers).sort()).toEqual(["notificationclick", "push"]);
    expect(SOURCE).not.toMatch(/caches\./);
  });

  it("shows the payload's title and body and keeps its app path", async () => {
    const { handlers, self } = loadWorker();
    const payload = { title: "ana geolocated your request", body: "Strike", path: "/events/1" };

    await dispatch(handlers.push, { data: { json: () => payload } });

    expect(self.registration.showNotification).toHaveBeenCalledWith(payload.title, {
      body: "Strike",
      icon: "/icon/android-192",
      data: { path: "/events/1" },
    });
  });

  it.each(["https://evil.example/x", "//evil.example/x", "/\\evil.example", undefined])(
    "replaces an off-site or missing path (%s) with the feed",
    async (bad) => {
      const { handlers, self } = loadWorker();
      await dispatch(handlers.push, { data: { json: () => ({ title: "t", path: bad }) } });
      const [, options] = self.registration.showNotification.mock.calls[0];
      expect(options.data).toEqual({ path: "/notifications" });
    },
  );

  it("survives a payload that is not JSON", async () => {
    const { handlers, self } = loadWorker();
    await dispatch(handlers.push, {
      data: {
        json: () => {
          throw new SyntaxError("bad");
        },
      },
    });
    expect(self.registration.showNotification).toHaveBeenCalledWith("Vidit", expect.anything());
  });

  it("focuses an open Vidit window and navigates it on click", async () => {
    const navigate = vi.fn().mockResolvedValue(null);
    const client = { url: `${ORIGIN}/map`, focus: vi.fn(), navigate };
    client.focus.mockResolvedValue(client);
    const { handlers, self } = loadWorker({ windows: [client] });
    const close = vi.fn();

    await dispatch(handlers.notificationclick, {
      notification: { close, data: { path: "/events/1" } },
    });

    expect(close).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(`${ORIGIN}/events/1`);
    expect(self.clients.openWindow).not.toHaveBeenCalled();
  });

  it("opens a window when none is open", async () => {
    const { handlers, self } = loadWorker();
    await dispatch(handlers.notificationclick, {
      notification: { close: vi.fn(), data: { path: "/profile/ana" } },
    });
    expect(self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/profile/ana`);
  });
});
