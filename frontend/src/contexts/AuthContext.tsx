"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  ReactNode,
} from "react";
import type { User } from "@/types";
import { ApiError, apiFetch } from "@/lib/api";
import { hasSessionCookie } from "@/lib/auth";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  /**
   * Stage a registration. Returns once the backend has queued the
   * confirmation email — does NOT sign the user in (the caller renders a
   * "check your email" page). The session cookie is set later by
   * /confirm-registration when the user clicks the email link.
   */
  register: (
    username: string,
    email: string,
    password: string,
    invite_code: string
  ) => Promise<{ status: string; email: string }>;
  logout: () => Promise<void>;
  /**
   * Re-pull the current user from /auth/me. Used by /confirm-registration
   * after the server sets the session cookie so the app reads the new user
   * without a hard reload.
   */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Bumped on every login/logout. An in-flight fetchUser issued before the
  // bump must NOT overwrite the newer state when it resolves — that race
  // would flip a freshly-logged-in user back to null when a pre-login /me
  // request arrives late.
  const stateVersion = useRef(0);
  // Self-reference for the retry-on-transient branch. `react-hooks` v7
  // (React Compiler) flags a raw `fetchUser(false)` inside the `useCallback`
  // defining it as a TDZ access — the closure captures the binding before
  // it resolves. Routing the recursive call through a ref breaks the cycle:
  // the ref is assigned after the `useCallback`, and the `setTimeout` reads
  // it 500ms later when the binding is long since live.
  const fetchUserRef = useRef<((retryOnTransient?: boolean) => Promise<void>) | null>(null);

  const fetchUser = useCallback(async (retryOnTransient = true) => {
    // No JS-visible session cookie → skip /auth/me. The probe would 401 —
    // functionally the right answer, but it reads as "site is broken" in
    // the DevTools console on every logged-out load and pads the Sentry
    // breadcrumb chain on real errors. `hasSessionCookie` checks
    // `vidit_csrf`, which tracks the HttpOnly session cookie's lifecycle
    // (see `lib/auth.ts`).
    //
    // No `stateVersion` check: this branch is synchronous (no `await`
    // before return), so `stateVersion.current` can't change underneath.
    // The guard below protects the async path where login/logout may race.
    if (!hasSessionCookie()) {
      setUser(null);
      setLoading(false);
      return;
    }
    const version = stateVersion.current;
    try {
      const me = await apiFetch<User>("/auth/me");
      if (version !== stateVersion.current) return;
      setUser(me);
      setLoading(false);
    } catch (err) {
      if (version !== stateVersion.current) return;
      // Only 401/403 means "definitely logged out". Anything else (5xx,
      // network blip, dev uvicorn restart, CORS preflight failure) is
      // transient — every auth-gated page guards on
      // `if (!user) router.push("/login")`, so an unconditional null bounces
      // the analyst out of a working session on any hiccup. Retry once with
      // a small delay to bridge the outage, then give up.
      const isAuthFailure =
        err instanceof ApiError && (err.status === 401 || err.status === 403);
      if (!isAuthFailure && retryOnTransient) {
        setTimeout(() => fetchUserRef.current?.(false), 500);
        return;
      }
      if (isAuthFailure) setUser(null);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Assigned in an effect, not during render — `react-hooks` v7 (React
    // Compiler) forbids ref writes during render. The retry-branch
    // setTimeout fires after this commit, so the binding is live by then.
    fetchUserRef.current = fetchUser;
  }, [fetchUser]);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const login = async (email: string, password: string) => {
    const me = await apiFetch<User>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    stateVersion.current += 1;
    setUser(me);
  };

  const register = async (
    username: string,
    email: string,
    password: string,
    invite_code: string
  ) => {
    return apiFetch<{ status: string; email: string }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, email, password, invite_code }),
    });
  };

  const logout = async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {
      // Drop local state even if the server call fails — the user wants out.
    }
    stateVersion.current += 1;
    setUser(null);
    // Hard navigate here rather than in each caller: keeps the post-logout
    // destination consistent and wipes in-memory state (map, filters, cached
    // fetches) so the next session starts clean instead of flashing a
    // half-rendered map behind a suddenly-null user.
    if (typeof window !== "undefined") {
      window.location.assign("/login");
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, login, register, logout, refresh: fetchUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
