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
   * Stage a registration. Returns when the backend has accepted the
   * payload and queued the confirmation email — does NOT sign the user
   * in. The caller is expected to render a "check your email" page.
   * The session cookie is set later, by /confirm-registration, when
   * the user clicks the email link.
   */
  register: (
    username: string,
    email: string,
    password: string,
    invite_code: string
  ) => Promise<{ status: string; email: string }>;
  logout: () => Promise<void>;
  /**
   * Re-pull the current user from /auth/me. Used by the
   * /confirm-registration page after the server sets the session
   * cookie so the rest of the app immediately reads the new user
   * without a hard reload.
   */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Bumped every time login/logout produces an authoritative user state. Any
  // in-flight fetchUser issued before that bump must NOT overwrite the
  // newer state when it resolves — that's the race that would otherwise
  // flip a freshly-logged-in user back to null when the pre-login /me
  // request arrives late.
  const stateVersion = useRef(0);
  // Self-reference handle for the retry-on-transient branch below. The
  // React Compiler-integrated `react-hooks` v7 rule rightly flags a raw
  // `fetchUser(false)` call inside the `useCallback` defining `fetchUser`
  // as a TDZ access (the closure captures the binding before it resolves).
  // Routing the recursive call through a ref breaks the cycle: the ref is
  // assigned right after the `useCallback`, and the `setTimeout` reads it
  // 500ms later when the binding is long since live.
  const fetchUserRef = useRef<((retryOnTransient?: boolean) => Promise<void>) | null>(null);

  const fetchUser = useCallback(async (retryOnTransient = true) => {
    // No JS-visible session cookie → don't bother /auth/me. The probe
    // would 401, which is functionally the answer we want but reads as
    // "the site is broken" in the DevTools console on every logged-out
    // page load and pads the Sentry breadcrumb chain attached to real
    // errors. `hasSessionCookie` checks the `vidit_csrf` cookie which
    // tracks the HttpOnly session cookie's lifecycle (set + cleared
    // together) — see `lib/auth.ts` for the rationale.
    //
    // No `stateVersion` check here because this branch is synchronous
    // (no `await` between entry and return): `stateVersion.current`
    // cannot change underneath. The version guard below protects the
    // async path where login/logout may race with an in-flight probe.
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
      // Only treat 401/403 as "definitely logged out". Anything else
      // (5xx, network blip, dev-time uvicorn restart, CORS preflight
      // failure) is transient — every auth-gated page guards on
      // `if (!user) router.push("/login")`, so an unconditional null
      // bounces the analyst out of a working session on any backend
      // hiccup. Retry once with a small delay to bridge the outage;
      // if it's still failing after that, give up.
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
    // Ref assignment in an effect (not during render) — React Compiler-
    // integrated `react-hooks` v7 forbids ref writes during render. The
    // setTimeout in the retry branch fires after this commit phase runs,
    // so by the time it reads `fetchUserRef.current`, the binding is live.
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
      // Even if the server call fails, drop local state — the user clearly
      // wants to be logged out from this client.
    }
    stateVersion.current += 1;
    setUser(null);
    // Hard navigate to the sign-in screen. Doing it here rather than in each
    // caller (a) makes the post-logout destination consistent everywhere and
    // (b) wipes in-memory state (map, filters, cached fetches) so the next
    // session starts clean instead of flashing a half-rendered map behind a
    // suddenly-null user.
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
