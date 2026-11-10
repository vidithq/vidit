import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/test/apiStub";
vi.mock("@/lib/api", () => import("@/test/apiStub"));
const link = vi.hoisted(() => ({ token: "abc123.request_fulfilled.sig" as string | null }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => link.token }),
}));

import NotificationUnsubscribePage from "./page";

describe("NotificationUnsubscribePage", () => {
  beforeEach(() => {
    link.token = "abc123.request_fulfilled.sig";
    apiFetch.mockReset();
  });

  it("names the kind, turns nothing off until the reader confirms, then posts the token", async () => {
    apiFetch.mockResolvedValue(undefined);
    render(<NotificationUnsubscribePage />);

    expect(screen.getByText(/“Request fulfilled”/)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));

    expect(await screen.findByText("Email turned off")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith(
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
