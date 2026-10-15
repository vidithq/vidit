import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
const push = vi.hoisted(() => ({ forgetThisPushDevice: vi.fn() }));

vi.mock("@/lib/api", () => ({
  apiFetch: api.apiFetch,
  ApiError: class extends Error {},
}));
vi.mock("@/lib/auth", () => ({ hasSessionCookie: () => true }));
vi.mock("@/lib/push", () => push);

import { AuthProvider, useAuth } from "./AuthContext";

describe("AuthProvider logout", () => {
  it("clears the display cache, so the next account on this browser starts clean", async () => {
    api.apiFetch.mockImplementation((path: string) =>
      Promise.resolve(path === "/auth/me" ? { id: "u1", username: "ana" } : undefined),
    );
    window.localStorage.setItem("vidit:palette", "rose");
    window.localStorage.setItem("vidit:theme", "light");
    window.localStorage.setItem("vidit:help-hidden", "1");
    window.localStorage.setItem("vidit:display-owner", "u1");
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      assign,
    });

    let logout: () => Promise<void> = async () => {};
    function Probe() {
      logout = useAuth().logout;
      return null;
    }
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalledWith("/auth/me"));

    await act(() => logout());

    for (const key of ["vidit:palette", "vidit:theme", "vidit:help-hidden", "vidit:display-owner"]) {
      expect(window.localStorage.getItem(key)).toBeNull();
    }
    expect(assign).toHaveBeenCalledWith("/login");
  });

  it("forgets this push device while the session still holds", async () => {
    const calls: string[] = [];
    api.apiFetch.mockImplementation((path: string) => {
      calls.push(path);
      return Promise.resolve(path === "/auth/me" ? { id: "u1", username: "ana" } : undefined);
    });
    push.forgetThisPushDevice.mockImplementation(async () => {
      calls.push("forget push device");
    });
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, assign: vi.fn() });

    let logout: () => Promise<void> = async () => {};
    function Probe() {
      logout = useAuth().logout;
      return null;
    }
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(calls).toContain("/auth/me"));
    await act(() => logout());

    expect(calls.slice(-2)).toEqual(["forget push device", "/auth/logout"]);
  });
});
