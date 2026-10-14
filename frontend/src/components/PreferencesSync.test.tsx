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

const SERVER = {
  display: { palette: "blue", theme: "light", help_tooltips: false },
};

describe("PreferencesSync", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("vidit:palette", "rose");
    window.localStorage.setItem("vidit:theme", "dark");
    session.user = null;
    session.apiFetch.mockReset();
  });

  it("leaves the local cache alone while signed out", () => {
    render(<PreferencesSync />);

    expect(session.apiFetch).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("vidit:palette")).toBe("rose");
  });

  it("lets the server value win after sign-in and rewrites the local cache", async () => {
    session.apiFetch.mockResolvedValue(SERVER);
    const { rerender } = render(<PreferencesSync />);

    session.user = { id: "u1" };
    rerender(<PreferencesSync />);

    await waitFor(() => expect(window.localStorage.getItem("vidit:palette")).toBe("blue"));
    expect(window.localStorage.getItem("vidit:theme")).toBe("light");
    expect(window.localStorage.getItem("vidit:help-hidden")).toBe("1");
    expect(document.documentElement.dataset.palette).toBe("blue");
  });

  it("does not undo a change made while the pull was in flight", async () => {
    let answer: (value: typeof SERVER) => void = () => {};
    session.apiFetch.mockImplementation((_path: string, init?: RequestInit) =>
      init?.method === "PATCH"
        ? Promise.resolve(SERVER)
        : new Promise((resolve) => {
            answer = resolve;
          }),
    );
    session.user = { id: "u1" };
    render(<PreferencesSync />);

    await saveDisplay({ palette: "emerald" });
    answer(SERVER);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.localStorage.getItem("vidit:palette")).toBe("emerald");
    expect(window.localStorage.getItem("vidit:theme")).toBe("dark");
  });
});
