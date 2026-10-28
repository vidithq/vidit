import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: null as { id: string } | null, loading: false }));
const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { useRequireAuth } from "./useRequireAuth";

describe("useRequireAuth", () => {
  beforeEach(() => {
    auth.user = null;
    auth.loading = false;
    router.replace.mockReset();
    window.history.replaceState(null, "", "/sites/s1/sources/new?from=map");
  });

  it("sends a signed-out visitor to sign-in, which returns to this page", () => {
    renderHook(() => useRequireAuth());
    expect(router.replace).toHaveBeenCalledWith(
      "/login?next=%2Fsites%2Fs1%2Fsources%2Fnew%3Ffrom%3Dmap",
    );
  });

  it("waits for the session check and leaves a signed-in reader in place", () => {
    auth.loading = true;
    const { rerender } = renderHook(() => useRequireAuth());
    auth.loading = false;
    auth.user = { id: "u1" };
    rerender();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
