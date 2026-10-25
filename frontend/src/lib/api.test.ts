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
