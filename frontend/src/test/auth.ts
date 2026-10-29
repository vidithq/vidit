import { vi } from "vitest";

/** The `useAuth()` value of a signed-in analyst; `user` overrides the default id and email. */
export function signedInAs(username: string, user: Record<string, unknown> = {}) {
  return {
    user: { id: `id-${username}`, username, email: `${username}@example.test`, ...user },
    loading: false,
    logout: vi.fn(),
    refresh: vi.fn(),
  };
}

/** The `useAuth()` value of a visitor with no session. */
export function signedOut() {
  return { user: null, loading: false, logout: vi.fn(), refresh: vi.fn() };
}
