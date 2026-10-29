import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async (actual) => ({ ...(await actual<typeof import("@/lib/api")>()), apiFetch }));

const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ refresh }) }));

const push = vi.hoisted(() => vi.fn());
const search = vi.hoisted(() => ({ token: "a-valid-looking-token" as string | null }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => search.token }),
  useRouter: () => ({ push, replace: push }),
}));

import { ApiError } from "@/lib/api";
import ConfirmRegistrationPage from "./page";

describe("ConfirmRegistrationPage", () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    apiFetch.mockReset();
    refresh.mockReset();
    push.mockReset();
    search.token = "a-valid-looking-token";
  });

  it("offers the archive import and the Getting started page, and moves nowhere on its own", async () => {
    vi.useFakeTimers();
    apiFetch.mockResolvedValue({});
    refresh.mockResolvedValue(undefined);
    render(<ConfirmRegistrationPage />);
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByText("Account confirmed")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith(
      "/auth/confirm-registration",
      expect.objectContaining({ method: "POST" }),
    );
    expect(
      screen.getByRole("link", { name: "Import your X archive" }),
    ).toHaveAttribute("href", "/submit?import=1");
    expect(
      screen.getByRole("link", { name: "Read Getting started" }),
    ).toHaveAttribute("href", "/guide");

    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(push).not.toHaveBeenCalled();
  });

  it("reads a refused token as expired or invalid, with the way to a new link", async () => {
    apiFetch.mockRejectedValue(
      new ApiError("Invalid or expired confirmation link.", 400, "invalid_or_expired_token"),
    );
    render(<ConfirmRegistrationPage />);

    expect(await screen.findByText("Link expired or invalid")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get a new confirmation link" })).toHaveAttribute(
      "href",
      "/resend-confirmation",
    );
    expect(screen.queryByRole("link", { name: "Read Getting started" })).toBeNull();
  });

  it.each([null, "abc"])("refuses the token %s without calling the API", (token) => {
    search.token = token;
    render(<ConfirmRegistrationPage />);

    expect(screen.getByText("Link expired or invalid")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("offers Retry when Vidit does not answer, and confirms on the retry", async () => {
    const noAnswer = { title: "Vidit does not respond", message: "Check your connection, then retry.", fields: {} };
    apiFetch.mockRejectedValueOnce(new ApiError("Vidit does not respond.", 0, null, false, noAnswer));
    apiFetch.mockResolvedValueOnce({});
    refresh.mockResolvedValue(undefined);
    render(<ConfirmRegistrationPage />);

    expect(await screen.findByText("Vidit does not respond")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Account confirmed")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});
