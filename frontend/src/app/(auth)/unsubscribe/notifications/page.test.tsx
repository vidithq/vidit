import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiFetch: api.apiFetch,
  errorMessage: (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback),
  ApiError: class extends Error {},
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => "abc123.request_fulfilled.sig" }),
}));

import NotificationUnsubscribePage from "./page";

describe("NotificationUnsubscribePage", () => {
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
});
