import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ reportSessionRejected: vi.fn() }));
vi.mock("./session", () => session);

import { ApiError, apiFetch } from "./api";

function answer(status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ detail: "Invalid token" }), { status })),
  );
}

describe("apiFetch and a rejected session", () => {
  beforeEach(() => session.reportSessionRejected.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it("reports a 401 on a call that needs the session, and still throws it", async () => {
    answer(401);
    await expect(apiFetch("/notifications/unread-count")).rejects.toMatchObject({
      status: 401,
    });
    expect(session.reportSessionRejected).toHaveBeenCalledTimes(1);
  });

  it("reports a 401 on a write and on a path with a query", async () => {
    answer(401);
    await expect(apiFetch("/collections/c1/events", { method: "POST" })).rejects.toBeInstanceOf(
      ApiError,
    );
    await expect(apiFetch("/events/e1/approvals?all_versions=true")).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(session.reportSessionRejected).toHaveBeenCalledTimes(2);
  });

  it("marks the error when a signed-in session takes the rejection, so a form shows nothing", async () => {
    answer(401);
    session.reportSessionRejected.mockReturnValue(true);
    const err = await apiFetch("/users/me", { method: "PATCH" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 401, sessionRejected: true });
    session.reportSessionRejected.mockReturnValue(false);
    const anonymous = await apiFetch("/users/me", { method: "PATCH" }).catch((e: unknown) => e);
    expect(anonymous).toMatchObject({ status: 401, sessionRejected: false });
  });

  it("does not report a 403, which refuses a live session", async () => {
    answer(403);
    await expect(apiFetch("/events/e1/collections")).rejects.toMatchObject({ status: 403 });
    expect(session.reportSessionRejected).not.toHaveBeenCalled();
  });

  it.each(["/auth/login", "/auth/me"])("does not report a 401 from %s", async (path) => {
    answer(401);
    await expect(apiFetch(path)).rejects.toMatchObject({ status: 401 });
    expect(session.reportSessionRejected).not.toHaveBeenCalled();
  });
});

describe("apiFetch and what a reader is told", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads a request that gets no answer as Vidit not responding, never the browser's words", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const err = await apiFetch("/search?q=drone").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 0,
      message: "Vidit does not respond. Check your connection, then retry.",
      readable: { title: "Vidit does not respond", message: "Check your connection, then retry." },
    });
  });

  it("passes an abort through untouched, so a superseded read stays silent", async () => {
    const controller = new AbortController();
    const abort = new DOMException("The operation was aborted.", "AbortError");
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(abort)));
    controller.abort();
    await expect(apiFetch("/events/points", { signal: controller.signal })).rejects.toBe(abort);
  });

  it("reads a refused body field by field and waits out a rate limit", async () => {
    const detail = [
      {
        loc: ["body", "x_handle"],
        msg: "Value error, 15 characters at most: letters, digits and _",
        type: "value_error",
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail }), { status: 422 })),
    );
    const refused = await apiFetch("/users/me/invite-codes", { method: "POST" }).catch(
      (e: unknown) => e,
    );
    expect(refused).toMatchObject({
      status: 422,
      readable: { fields: { x_handle: "15 characters at most: letters, digits and _." } },
    });

    const limited = {
      detail: { code: "rate_limited", message: "Rate limit exceeded. Try again later." },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(limited), { status: 429, headers: { "Retry-After": "120" } }),
      ),
    );
    const err = await apiFetch("/auth/forgot-password", { method: "POST" }).catch(
      (e: unknown) => e,
    );
    expect(err).toMatchObject({
      code: "rate_limited",
      message: "Too many attempts. Try again in 2 minutes.",
    });
  });

  it("reads a 5xx with an unreadable body as a fault on Vidit's side", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Internal Server Error", { status: 500 })),
    );
    await expect(apiFetch("/events/e1")).rejects.toMatchObject({
      status: 500,
      message: "Vidit hit a problem. Retry in a moment.",
    });
  });
});
