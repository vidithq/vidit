import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { XHandleState } from "@/lib/xHandle";

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock("@/lib/api", () => ({
  apiFetch: api.apiFetch,
  ApiError: class extends Error {},
  errorMessage: (err: unknown, fallback = "Something went wrong.") =>
    err instanceof Error ? err.message : fallback,
}));

import { AccountXHandle } from "./AccountXHandle";

const PENDING: XHandleState["request"] = {
  id: "r1",
  x_handle: "new_hawk",
  reason: null,
  status: "pending",
  decline_reason: null,
  created_at: "2026-10-01T10:00:00Z",
  decided_at: null,
};

function serve(state: XHandleState, afterPut?: XHandleState) {
  api.apiFetch.mockReset().mockImplementation((_path: string, init?: RequestInit) =>
    Promise.resolve(init?.method === "PUT" ? afterPut : state),
  );
}

describe("AccountXHandle", () => {
  beforeEach(() => api.apiFetch.mockReset());

  it("shows the bound handle read-only", async () => {
    serve({ x_handle: "osint_hawk", request: null });
    render(<AccountXHandle />);

    expect(await screen.findByText("@osint_hawk")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("osint_hawk")).toBeNull();
    expect(screen.getByRole("button", { name: "Request a change" })).toBeInTheDocument();
  });

  it("says so when no handle is linked", async () => {
    serve({ x_handle: null, request: null });
    render(<AccountXHandle />);

    expect(await screen.findByText("No X handle linked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request a link" })).toBeInTheDocument();
  });

  it("shows a pending request and a declined one with its reason", async () => {
    serve({ x_handle: null, request: PENDING });
    const { unmount } = render(<AccountXHandle />);
    expect(await screen.findByText("Pending")).toBeInTheDocument();
    expect(screen.getByText(/You asked for @new_hawk/)).toBeInTheDocument();
    unmount();

    serve({
      x_handle: null,
      request: {
        ...PENDING,
        status: "declined",
        decline_reason: "Post from the new handle first",
        decided_at: "2026-10-02T10:00:00Z",
      },
    });
    render(<AccountXHandle />);
    expect(await screen.findByText("Declined")).toBeInTheDocument();
    expect(screen.getByText(/Post from the new handle first/)).toBeInTheDocument();
  });

  it("files a request and shows it pending", async () => {
    serve({ x_handle: "old_hawk", request: null }, { x_handle: "old_hawk", request: PENDING });
    render(<AccountXHandle />);

    fireEvent.click(await screen.findByRole("button", { name: "Request a change" }));
    fireEvent.change(screen.getByLabelText("New X handle"), {
      target: { value: " @New_Hawk " },
    });
    fireEvent.change(screen.getByLabelText("Reason (optional)"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    expect(await screen.findByText("Pending")).toBeInTheDocument();
    const put = api.apiFetch.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(put?.[0]).toBe("/users/me/x-handle-request");
    expect(JSON.parse(put?.[1].body)).toEqual({ x_handle: "@New_Hawk", reason: "Renamed" });
    await waitFor(() => expect(screen.queryByLabelText("New X handle")).toBeNull());
  });
});
