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

describe("apiFetch request headers", () => {
  afterEach(() => vi.unstubAllGlobals());

  function sentHeaders(): Record<string, string> {
    const fetchMock = vi.mocked(fetch);
    return fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
  }

  function stubOk() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
  }

  it("sends a GET without Content-Type, so the browser needs no preflight", async () => {
    stubOk();
    await apiFetch("/tags");
    expect(sentHeaders()).not.toHaveProperty("Content-Type");
  });

  it("marks a JSON body as JSON", async () => {
    stubOk();
    await apiFetch("/collections", { method: "POST", body: JSON.stringify({ name: "x" }) });
    expect(sentHeaders()["Content-Type"]).toBe("application/json");
  });

  it("leaves a multipart body to the browser, which sets the boundary", async () => {
    stubOk();
    await apiFetch("/uploads", { method: "POST", body: new FormData() });
    expect(sentHeaders()).not.toHaveProperty("Content-Type");
  });
});
