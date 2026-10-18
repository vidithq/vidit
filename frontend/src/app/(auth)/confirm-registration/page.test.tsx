import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));

const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ refresh }) }));

const push = vi.hoisted(() => vi.fn());
const search = vi.hoisted(() => ({ token: "a-valid-looking-token" as string | null }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => search.token }),
  useRouter: () => ({ push, replace: push }),
}));

import ConfirmRegistrationPage from "./page";

describe("ConfirmRegistrationPage", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    refresh.mockReset();
    push.mockReset();
    search.token = "a-valid-looking-token";
  });

  it("offers the archive import and the Getting started page, and moves nowhere on its own", async () => {
    apiFetch.mockResolvedValue({});
    refresh.mockResolvedValue(undefined);
    render(<ConfirmRegistrationPage />);

    expect(await screen.findByText("Account confirmed")).toBeInTheDocument();
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

    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(push).not.toHaveBeenCalled();
  });

  it("offers a fresh start when the link does not confirm", async () => {
    apiFetch.mockRejectedValue(new Error("This link has expired."));
    render(<ConfirmRegistrationPage />);

    expect(await screen.findByText("This link has expired.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Start over/ })).toHaveAttribute(
      "href",
      "/register",
    );
    expect(screen.queryByRole("link", { name: "Read Getting started" })).toBeNull();
  });

  it("refuses a link with no token without calling the API", () => {
    search.token = null;
    render(<ConfirmRegistrationPage />);

    expect(screen.getByText("This confirmation link is missing a token.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
