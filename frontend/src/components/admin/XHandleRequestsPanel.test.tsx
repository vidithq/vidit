import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminXHandleRequest } from "@/lib/xHandle";

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock("@/lib/api", () => ({
  apiFetch: api.apiFetch,
  ApiError: class extends Error {},
  errorMessage: (err: unknown, fallback = "Something went wrong.") =>
    err instanceof Error ? err.message : fallback,
}));

import { XHandleRequestsPanel } from "./XHandleRequestsPanel";

const REQUEST: AdminXHandleRequest = {
  id: "r1",
  user: {
    id: "u1",
    username: "ana",
    email: "ana@example.test",
    is_admin: false,
    x_handle: "old_hawk",
    invite_minting_enabled: true,
    sponsor: null,
    created_at: "2026-01-01T00:00:00Z",
  },
  x_handle: "new_hawk",
  reason: "Renamed my account",
  created_at: "2026-10-01T10:00:00Z",
};

function posts(): [string, unknown][] {
  return api.apiFetch.mock.calls
    .filter(([, init]) => init?.method === "POST")
    .map(([path, init]) => [path, init.body ? JSON.parse(init.body) : undefined]);
}

describe("XHandleRequestsPanel", () => {
  beforeEach(() => {
    api.apiFetch
      .mockReset()
      .mockImplementation((_path: string, init?: RequestInit) =>
        Promise.resolve(init?.method === "POST" ? undefined : [REQUEST]),
      );
  });

  it("lists a pending request beside the account's current handle", async () => {
    render(<XHandleRequestsPanel />);

    expect(await screen.findByText("ana")).toBeInTheDocument();
    expect(screen.getByText("X: @old_hawk")).toBeInTheDocument();
    expect(screen.getByText("X: @new_hawk")).toBeInTheDocument();
    expect(screen.getByText("Renamed my account")).toBeInTheDocument();
  });

  it("approves a request", async () => {
    render(<XHandleRequestsPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(posts()).toEqual([["/admin/x-handle-requests/r1/approve", undefined]]),
    );
  });

  it("declines only with a reason", async () => {
    render(<XHandleRequestsPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
    const confirm = screen.getByRole("button", { name: "Decline" });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Reason/), {
      target: { value: " Post from the new handle first " },
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(posts()).toEqual([
        ["/admin/x-handle-requests/r1/decline", { reason: "Post from the new handle first" }],
      ]),
    );
  });
});
