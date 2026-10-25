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
import type { components } from "@/lib/api-types";
import type { User } from "@/types";
import { ApiError, apiFetch } from "@/lib/api";
import { hasSessionCookie } from "@/lib/auth";
import { hardNavigate } from "@/lib/navigation";
import { clearDisplay } from "@/lib/preferences";
import { onSessionRejected } from "@/lib/session";

type RegisterResponse = components["schemas"]["RegisterResponse"];

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  /** Stage a registration: returns once the confirmation email is queued and does not sign
   *  in (the session cookie is set by /confirm-registration). */
  register: (
    username: string,
    email: string,
    password: string,
    invite_code: string
  ) => Promise<RegisterResponse>;
  logout: () => Promise<void>;
  /** Re-pull the user from /auth/me (used by /confirm-registration after the session cookie is set). */
  refresh: () => Promise<void>;
  /** True once a signed-in session was rejected by the server and the reader moved to signed
   *  out, until they sign in again or dismiss the notice. */
  sessionEnded: boolean;
  dismissSessionEnded: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionEnded, setSessionEnded] = useState(false);
  // Bumped on every login/logout so a late pre-login /me response can't overwrite newer state.
  const stateVersion = useRef(0);
  // Self-reference for the retry branch: `react-hooks` v7 flags a raw `fetchUser(false)` inside
  // its own `useCallback` as a TDZ access, so the call goes through a ref (assigned after,
  // read 500ms later).
  const fetchUserRef = useRef<((retryOnTransient?: boolean) => Promise<void>) | null>(null);

  const fetchUser = useCallback(async (retryOnTransient = true) => {
    // No JS-visible session cookie: skip /auth/me, whose 401 reads as "site is broken" in the
    // console and pads Sentry breadcrumbs. `hasSessionCookie` tracks the HttpOnly session's
    // lifecycle (see `lib/auth.ts`). No `stateVersion` check: this branch is synchronous, so
    // nothing can race it.
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
      // Only 401/403 means logged out. Anything else (5xx, network, CORS preflight) is
      // transient, and nulling the user would bounce analysts out of a working session on
      // gated pages: retry once after a delay.
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
    // Assigned in an effect: `react-hooks` v7 forbids ref writes during render.
    fetchUserRef.current = fetchUser;
  }, [fetchUser]);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  // A 401 on any call that needs the session (`lib/session.ts`) re-reads /auth/me once, however
  // many calls failed together. A 401 there too ends the session: the reader is signed out and
  // told so. Anything else (the user back, a 5xx, a network error) leaves the state alone, so a
  // backend hiccup never signs anyone out.
  const signedIn = useRef(false);
  useEffect(() => {
    signedIn.current = user !== null;
  }, [user]);
  const rechecking = useRef(false);
  useEffect(
    () =>
      onSessionRejected(() => {
        if (!signedIn.current || rechecking.current) return;
        rechecking.current = true;
        const version = stateVersion.current;
        apiFetch<User>("/auth/me")
          .then(
            (me) => {
              if (version === stateVersion.current) setUser(me);
            },
            (err) => {
              if (version !== stateVersion.current) return;
              if (err instanceof ApiError && err.status === 401) {
                stateVersion.current += 1;
                setUser(null);
                setSessionEnded(true);
              }
            },
          )
          .finally(() => {
            rechecking.current = false;
          });
      }),
    [],
  );

  const login = async (email: string, password: string) => {
    const me = await apiFetch<User>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    stateVersion.current += 1;
    setUser(me);
    setSessionEnded(false);
  };

  const register = async (
    username: string,
    email: string,
    password: string,
    invite_code: string
  ) => {
    return apiFetch<RegisterResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, email, password, invite_code }),
    });
  };

  const logout = async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {
      // Drop local state even if the server call fails.
    }
    stateVersion.current += 1;
    setUser(null);
    // The display cache belongs to the account leaving; the next one on this browser starts clean.
    clearDisplay();
    // Hard navigate here, not in each caller: consistent destination, and it wipes in-memory
    // state (map, filters, caches) so the next session starts clean.
    if (typeof window !== "undefined") {
      hardNavigate("/login");
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
        logout,
        refresh: fetchUser,
        sessionEnded,
        dismissSessionEnded: () => setSessionEnded(false),
      }}
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
