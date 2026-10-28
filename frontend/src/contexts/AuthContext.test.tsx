import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
const navigation = vi.hoisted(() => ({ hardNavigate: vi.fn() }));
const cookie = vi.hoisted(() => ({ present: true }));

vi.mock("@/lib/api", () => ({
  apiFetch: api.apiFetch,
  ApiError: class extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/lib/auth", () => ({ hasSessionCookie: () => cookie.present }));
vi.mock("@/lib/navigation", () => navigation);

import { ApiError } from "@/lib/api";
import { markSessionHeld, reportSessionRejected } from "@/lib/session";
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
    function Probe() {
      const { logout } = useAuth();
      return (
        <button type="button" onClick={() => void logout()}>
          Sign out
        </button>
      );
    }
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalledWith("/auth/me"));

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(navigation.hardNavigate).toHaveBeenCalledWith("/login"));

    for (const key of ["vidit:palette", "vidit:theme", "vidit:help-hidden", "vidit:display-owner"]) {
      expect(window.localStorage.getItem(key)).toBeNull();
    }
    expect(navigation.hardNavigate).toHaveBeenCalledWith("/login");
  });
});

const ANA = { id: "u1", username: "ana" };

/** Prints the auth state the way the app reads it. */
function State() {
  const { user, loading, sessionEnded } = useAuth();
  if (loading) return <p>loading</p>;
  return <p>{`${user ? user.username : "signed out"}${sessionEnded ? ", session ended" : ""}`}</p>;
}

/** `/auth/me` answers `ANA` on the first read, then each answer in `later` in turn. */
function meAnswers(...later: (typeof ANA | number)[]) {
  let reads = 0;
  api.apiFetch.mockImplementation((path: string) => {
    if (path !== "/auth/me") return Promise.resolve(undefined);
    const next = reads === 0 ? ANA : later[reads - 1];
    reads += 1;
    return typeof next === "number"
      ? Promise.reject(new ApiError("Invalid token", next))
      : Promise.resolve(next);
  });
}

const meReads = () => api.apiFetch.mock.calls.filter(([path]) => path === "/auth/me").length;

describe("AuthProvider and a rejected session", () => {
  beforeEach(() => api.apiFetch.mockReset());

  async function signedIn() {
    render(
      <AuthProvider>
        <State />
      </AuthProvider>,
    );
    await screen.findByText("ana");
  }

  it("signs the reader out when /auth/me answers 401 too", async () => {
    meAnswers(401);
    await signedIn();
    let taken = false;
    act(() => {
      taken = reportSessionRejected();
    });
    expect(taken).toBe(true);
    expect(await screen.findByText("signed out, session ended")).toBeInTheDocument();
  });

  it("leaves a rejection to the caller while nobody is signed in", async () => {
    meAnswers(401);
    await signedIn();
    act(() => reportSessionRejected());
    await screen.findByText("signed out, session ended");
    expect(reportSessionRejected()).toBe(false);
  });

  it("re-reads /auth/me once for calls that fail together", async () => {
    meAnswers(401);
    await signedIn();
    act(() => {
      reportSessionRejected();
      reportSessionRejected();
      reportSessionRejected();
    });
    await screen.findByText("signed out, session ended");
    expect(meReads()).toBe(2);
  });

  it("keeps the reader signed in when the session still holds", async () => {
    meAnswers(ANA);
    await signedIn();
    act(() => reportSessionRejected());
    await waitFor(() => expect(meReads()).toBe(2));
    expect(screen.getByText("ana")).toBeInTheDocument();
  });

  it("keeps the reader signed in when /auth/me fails for another reason", async () => {
    meAnswers(503);
    await signedIn();
    act(() => reportSessionRejected());
    await waitFor(() => expect(meReads()).toBe(2));
    expect(screen.getByText("ana")).toBeInTheDocument();
  });
});

describe("AuthProvider and a session that ended between loads", () => {
  beforeEach(() => {
    api.apiFetch.mockReset();
    window.localStorage.clear();
    cookie.present = true;
  });

  function boot() {
    return render(
      <AuthProvider>
        <State />
      </AuthProvider>,
    );
  }

  it("tells it once when the cookies are gone", async () => {
    meAnswers();
    const first = boot();
    await screen.findByText("ana");
    first.unmount();

    cookie.present = false;
    const second = boot();
    expect(await screen.findByText("signed out, session ended")).toBeInTheDocument();
    second.unmount();

    boot();
    expect(await screen.findByText("signed out")).toBeInTheDocument();
  });

  it("tells it when /auth/me refuses the cookie the browser kept", async () => {
    markSessionHeld(true);
    api.apiFetch.mockRejectedValue(new ApiError("Invalid token", 401));
    boot();
    expect(await screen.findByText("signed out, session ended")).toBeInTheDocument();
  });

  it("says nothing to a browser that never signed in", async () => {
    cookie.present = false;
    boot();
    expect(await screen.findByText("signed out")).toBeInTheDocument();
  });

  it("says nothing after a sign-out", async () => {
    meAnswers();
    function SignOut() {
      const { logout } = useAuth();
      return (
        <button type="button" onClick={() => void logout()}>
          Sign out
        </button>
      );
    }
    const first = render(
      <AuthProvider>
        <State />
        <SignOut />
      </AuthProvider>,
    );
    await screen.findByText("ana");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByText("signed out");
    first.unmount();

    cookie.present = false;
    boot();
    expect(await screen.findByText("signed out")).toBeInTheDocument();
  });
});
