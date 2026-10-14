import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
      {
        kind: "request_fulfilled",
        channels: { email: requestFulfilledEmail },
        defaults: { email: true },
      },
      { kind: "new_follower", channels: { email: false }, defaults: { email: false } },
    ],
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
          JSON.parse(String(init.body)).notifications?.request_fulfilled
          ? preferences(false)
          : preferences(),
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

  it("lists one email switch per notification kind with its default", async () => {
    render(<SettingsPage />);

    const fulfilled = await screen.findByRole("switch", {
      name: "Request fulfilled by email",
    });
    expect(fulfilled).toHaveAttribute("aria-checked", "true");
    expect(fulfilled).toHaveTextContent("Default: on.");
    const follower = screen.getByRole("switch", { name: "New follower by email" });
    expect(follower).toHaveAttribute("aria-checked", "false");
    expect(follower).toHaveTextContent("Default: off.");

    fireEvent.click(fulfilled);

    await waitFor(() => expect(fulfilled).toHaveAttribute("aria-checked", "false"));
    expect(patchBodies()).toEqual([
      { notifications: { request_fulfilled: { email: false } } },
    ]);
  });

  it.each([[[]], [{}], [{ notifications: [{ kind: "retired_kind" }] }]])(
    "renders without switches on a partial preferences payload (%j)",
    async (payload) => {
      api.apiFetch.mockReset().mockResolvedValue(payload);
      render(<SettingsPage />);

      await waitFor(() => expect(api.apiFetch).toHaveBeenCalled());
      expect(screen.getByRole("heading", { name: "Notifications" })).toBeInTheDocument();
      expect(screen.queryByRole("switch", { name: /by email/ })).toBeNull();
      expect(screen.getByRole("button", { name: "Update password" })).toBeInTheDocument();
    },
  );
});
