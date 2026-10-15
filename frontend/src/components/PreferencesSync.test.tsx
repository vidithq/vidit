import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveDisplay } from "@/lib/preferences";

const session = vi.hoisted(() => ({
  user: null as { id: string } | null,
  apiFetch: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ apiFetch: session.apiFetch }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: session.user, loading: false }),
}));

import PreferencesSync from "./PreferencesSync";

const NOTHING_STORED = { palette: null, theme: null, help_tooltips: null };

function serverWith(stored: Record<string, unknown>) {
  return { display_stored: { ...NOTHING_STORED, ...stored } };
}

function patchBodies(): unknown[] {
  return session.apiFetch.mock.calls
    .filter(([, init]) => init?.method === "PATCH")
    .map(([, init]) => JSON.parse(init.body));
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("PreferencesSync", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("vidit:palette", "rose");
    window.localStorage.setItem("vidit:theme", "light");
    session.user = null;
    session.apiFetch.mockReset();
  });

  it("leaves the local cache alone while signed out", () => {
    render(<PreferencesSync />);

    expect(session.apiFetch).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("vidit:palette")).toBe("rose");
  });

  it("lets a value the account saved win and rewrites the local cache", async () => {
    session.apiFetch.mockResolvedValue(
      serverWith({ palette: "blue", theme: "dark", help_tooltips: false }),
    );
    const { rerender } = render(<PreferencesSync />);

    session.user = { id: "u1" };
    rerender(<PreferencesSync />);

    await waitFor(() => expect(window.localStorage.getItem("vidit:palette")).toBe("blue"));
    expect(window.localStorage.getItem("vidit:theme")).toBe("dark");
    expect(window.localStorage.getItem("vidit:help-hidden")).toBe("1");
    expect(document.documentElement.dataset.palette).toBe("blue");
    expect(patchBodies()).toEqual([]);
  });

  it("writes the browser's own value up where the account saved none", async () => {
    window.localStorage.setItem("vidit:display-owner", "u1");
    session.apiFetch.mockResolvedValue(serverWith({ palette: "violet" }));
    session.user = { id: "u1" };
    render(<PreferencesSync />);

    await waitFor(() => expect(patchBodies()).toEqual([{ display: { theme: "light" } }]));
    // The saved palette still wins; the unsaved theme keeps this browser's choice.
    expect(window.localStorage.getItem("vidit:palette")).toBe("violet");
    expect(window.localStorage.getItem("vidit:theme")).toBe("light");
  });

  it("adopts a cache that carries no owner and tags it with the account", async () => {
    session.apiFetch.mockResolvedValue(serverWith({}));
    session.user = { id: "u1" };
    render(<PreferencesSync />);

    await waitFor(() =>
      expect(patchBodies()).toEqual([{ display: { palette: "rose", theme: "light" } }]),
    );
    expect(window.localStorage.getItem("vidit:display-owner")).toBe("u1");
  });

  it("never uploads another account's cache, and clears it for this one", async () => {
    window.localStorage.setItem("vidit:display-owner", "someone-else");
    window.localStorage.setItem("vidit:help-hidden", "1");
    session.apiFetch.mockResolvedValue(serverWith({ palette: "blue" }));
    session.user = { id: "u1" };
    render(<PreferencesSync />);

    await waitFor(() => expect(window.localStorage.getItem("vidit:palette")).toBe("blue"));
    await flush();
    expect(patchBodies()).toEqual([]);
    expect(window.localStorage.getItem("vidit:theme")).toBeNull();
    expect(window.localStorage.getItem("vidit:help-hidden")).toBeNull();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(window.localStorage.getItem("vidit:display-owner")).toBe("u1");
  });

  it("touches neither side when the payload carries no stored values", async () => {
    session.apiFetch.mockResolvedValue([]);
    session.user = { id: "u1" };
    render(<PreferencesSync />);

    await waitFor(() => expect(session.apiFetch).toHaveBeenCalledTimes(1));
    await flush();
    expect(patchBodies()).toEqual([]);
    expect(window.localStorage.getItem("vidit:theme")).toBe("light");
  });

  it("uploads nothing when neither side saved a value", async () => {
    window.localStorage.clear();
    session.apiFetch.mockResolvedValue(serverWith({}));
    session.user = { id: "u1" };
    render(<PreferencesSync />);

    await waitFor(() => expect(session.apiFetch).toHaveBeenCalledTimes(1));
    await flush();
    expect(patchBodies()).toEqual([]);
    expect(window.localStorage.getItem("vidit:theme")).toBeNull();
  });

  it("does not undo a change made while the pull was in flight", async () => {
    let answer: (value: unknown) => void = () => {};
    session.apiFetch.mockImplementation((_path: string, init?: RequestInit) =>
      init?.method === "PATCH"
        ? Promise.resolve({})
        : new Promise((resolve) => {
            answer = resolve;
          }),
    );
    session.user = { id: "u1" };
    render(<PreferencesSync />);

    await saveDisplay("u1", { palette: "emerald" });
    answer(serverWith({ palette: "blue", theme: "dark" }));
    await flush();

    expect(window.localStorage.getItem("vidit:palette")).toBe("emerald");
    expect(window.localStorage.getItem("vidit:theme")).toBe("light");
  });
});
