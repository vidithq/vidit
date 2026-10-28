import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiFetch: api.apiFetch,
  errorMessage: (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback),
  ApiError: class extends Error {},
}));
const link = vi.hoisted(() => ({ token: "abc123.request_fulfilled.sig" as string | null }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => link.token }),
}));

import NotificationUnsubscribePage from "./page";

describe("NotificationUnsubscribePage", () => {
  beforeEach(() => {
    link.token = "abc123.request_fulfilled.sig";
    api.apiFetch.mockReset();
  });

  it("names the kind, turns nothing off until the reader confirms, then posts the token", async () => {
    api.apiFetch.mockResolvedValue(undefined);
    render(<NotificationUnsubscribePage />);

    expect(screen.getByText(/“Request fulfilled”/)).toBeInTheDocument();
    expect(api.apiFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));

    expect(await screen.findByText("Email turned off")).toBeInTheDocument();
    expect(api.apiFetch).toHaveBeenCalledWith(
      "/notifications/unsubscribe?token=abc123.request_fulfilled.sig",
      { method: "POST" },
    );
  });

  it("reads as an incomplete link, with the way to Settings, when the token is missing", () => {
    link.token = null;
    render(<NotificationUnsubscribePage />);

    expect(screen.getByRole("heading", { name: "Incomplete link" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
