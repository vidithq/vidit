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

function preferences(requestFulfilledEmail = true, productUpdates = false): UserPreferences {
  return {
    display: DISPLAY,
    display_defaults: DISPLAY,
    display_stored: { palette: null, theme: null, help_tooltips: null },
    notifications: [
      {
        kind: "request_fulfilled",
        channels: { email: requestFulfilledEmail, push: true },
        defaults: { email: true, push: true },
      },
      {
        kind: "new_follower",
        channels: { email: false, push: false },
        defaults: { email: false, push: false },
      },
    ],
    product_updates: productUpdates,
    review_request_audience: "following",
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
          : preferences(true, init?.method === "PATCH" && JSON.parse(String(init.body)).product_updates === true),
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

  it("lists one push switch per kind and says what this device can do", async () => {
    render(<SettingsPage />);

    const follower = await screen.findByRole("switch", { name: "New follower by push" });
    expect(follower).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "Request fulfilled by push" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // jsdom has no Push API.
    expect(
      await screen.findByText(/This browser cannot receive push notifications\./),
    ).toHaveTextContent("add Vidit to the Home Screen");
    expect(screen.queryByRole("button", { name: "Enable on this device" })).toBeNull();

    fireEvent.click(follower);
    await waitFor(() =>
      expect(patchBodies()).toEqual([{ notifications: { new_follower: { push: true } } }]),
    );
  });

  it("lists the account's push devices and revokes one", async () => {
    const devices = [
      {
        id: "d1",
        user_agent: "Mozilla/5.0 (Pixel 8)",
        created_at: "2026-10-01T09:00:00Z",
        last_success_at: null,
      },
    ];
    const base = api.apiFetch.getMockImplementation()!;
    api.apiFetch.mockImplementation((path: string, init?: RequestInit) =>
      path === "/users/me/push-subscriptions"
        ? Promise.resolve(devices)
        : path.startsWith("/users/me/push-subscriptions/")
          ? Promise.resolve(undefined)
          : base(path, init),
    );
    render(<SettingsPage />);

    expect(await screen.findByText("Mozilla/5.0 (Pixel 8)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/users/me/push-subscriptions/d1", {
        method: "DELETE",
      }),
    );
  });

  it("keeps the major release email switch off until the analyst turns it on", async () => {
    render(<SettingsPage />);

    const releases = await screen.findByRole("switch", { name: "Major release emails" });
    expect(releases).toHaveAttribute("aria-checked", "false");

    fireEvent.click(releases);

    await waitFor(() => expect(releases).toHaveAttribute("aria-checked", "true"));
    expect(patchBodies()).toEqual([{ product_updates: true }]);
  });

  it("saves who may send review requests", async () => {
    api.apiFetch.mockImplementation((_path: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === "PATCH"
          ? { ...preferences(), review_request_audience: "everyone" }
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
    expect(patchBodies()).toEqual([{ review_request_audience: "everyone" }]);
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
