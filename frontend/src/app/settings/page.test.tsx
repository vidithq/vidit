import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserPreferences } from "@/lib/preferences";

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock("@/lib/api", () => ({
  apiFetch: api.apiFetch,
  ApiError: class extends Error {},
  errorMessage: (err: unknown, fallback = "Something went wrong.") =>
    err instanceof Error ? err.message : fallback,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/hooks/useRequireAuth", () => ({
  useRequireAuth: () => ({
    user: { id: "u1", username: "ana", email: "ana@example.test" },
    loading: false,
  }),
}));

import SettingsPage from "./page";

const DISPLAY = { palette: "orange", theme: "dark", help_tooltips: true } as const;

function preferences(requestFulfilledEmail = true): UserPreferences {
  return {
    display: DISPLAY,
    display_defaults: DISPLAY,
    display_stored: { palette: null, theme: null, help_tooltips: null },
    notifications: [
      { kind: "request_fulfilled", email: requestFulfilledEmail, default: true },
      { kind: "new_follower", email: false, default: false },
    ],
    approval_request_audience: "following",
  };
}

function patchBodies(): unknown[] {
  return api.apiFetch.mock.calls
    .filter(([, init]) => init?.method === "PATCH")
    .map(([, init]) => JSON.parse(init.body));
}

describe("SettingsPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    api.apiFetch.mockReset().mockImplementation((_path: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === "PATCH" &&
          JSON.parse(String(init.body)).notifications?.request_fulfilled === false
          ? preferences(false)
          : preferences(true),
      ),
    );
  });

  it("shows the account's email, read-only, beside the username", () => {
    render(<SettingsPage />);

    const account = screen.getByRole("heading", { name: "Account" }).parentElement!;
    expect(account).toHaveTextContent("ana@example.test");
    expect(account).toHaveTextContent("ana");
    // Read-only: the address prints as text, not as a field.
    expect(screen.queryByDisplayValue("ana@example.test")).toBeNull();
  });

  it("applies a display change locally and writes it through to the account", async () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getByRole("switch", { name: "Light mode" }));
    expect(window.localStorage.getItem("vidit:theme")).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    fireEvent.click(screen.getByRole("radio", { name: "Rose" }));
    expect(window.localStorage.getItem("vidit:palette")).toBe("rose");

    fireEvent.click(screen.getByRole("switch", { name: "Show help tooltips" }));
    expect(window.localStorage.getItem("vidit:help-hidden")).toBe("1");

    await waitFor(() =>
      expect(patchBodies()).toEqual([
        { display: { theme: "light" } },
        { display: { palette: "rose" } },
        { display: { help_tooltips: false } },
      ]),
    );
  });

  it("lists one email switch per notification kind, its explanation behind its ?", async () => {
    render(<SettingsPage />);

    const fulfilled = await screen.findByRole("switch", { name: "Request fulfilled" });
    expect(fulfilled).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("button", { name: "What is the Request fulfilled notification?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "New follower" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.queryByText(/a request you opened/)).toBeNull();

    fireEvent.click(fulfilled);

    await waitFor(() => expect(fulfilled).toHaveAttribute("aria-checked", "false"));
    expect(patchBodies()).toEqual([
      { notifications: { request_fulfilled: false } },
    ]);
  });

  it("says Saved in the card's heading once a setting reaches the account", async () => {
    render(<SettingsPage />);

    const notifications = screen.getByRole("heading", { name: /Notifications/ }).parentElement!;
    expect(within(notifications).getByRole("status")).toHaveTextContent("");
    fireEvent.click(await screen.findByRole("switch", { name: "Request fulfilled" }));

    await waitFor(() => expect(within(notifications).getByRole("status")).toHaveTextContent("Saved"));
  });

  it("saves who may send approval requests", async () => {
    api.apiFetch.mockImplementation((_path: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === "PATCH"
          ? { ...preferences(), approval_request_audience: "everyone" }
          : preferences(),
      ),
    );
    render(<SettingsPage />);

    const following = await screen.findByRole("button", { name: "People I follow" });
    await waitFor(() => expect(following).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(screen.getByRole("button", { name: "Everyone" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Everyone" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(patchBodies()).toEqual([{ approval_request_audience: "everyone" }]);
  });

  it.each([[[]], [{}], [{ notifications: [{ kind: "retired_kind" }] }]])(
    "renders without switches on a partial preferences payload (%j)",
    async (payload) => {
      api.apiFetch.mockReset().mockResolvedValue(payload);
      render(<SettingsPage />);

      await waitFor(() => expect(api.apiFetch).toHaveBeenCalled());
      expect(screen.getByRole("heading", { name: "Notifications" })).toBeInTheDocument();
      expect(screen.queryByRole("switch", { name: "Request fulfilled" })).toBeNull();
      expect(screen.getByRole("button", { name: "Update password" })).toBeInTheDocument();
    },
  );
});
