import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { BIO_MAX_LEN, useProfileEdit } from "./useProfileEdit";
import { updateMyProfile, type PublicProfile } from "@/lib/users";

vi.mock("@/lib/users", () => ({
  updateMyProfile: vi.fn(),
}));

function profileFixture(overrides: Partial<PublicProfile> = {}): PublicProfile {
  return {
    id: "p1",
    username: "ana",
    is_trusted: false,
    trust_reason: null,
    bio: "OSINT analyst.",
    avatar_url: "https://cdn.example/a.png",
    external_links: { x: "@ana" },
    created_at: "2026-01-01T00:00:00Z",
    geolocations_count: 3,
    followers_count: 1,
    following_count: 2,
    is_following: false,
    ...overrides,
  };
}

function setup(profile: PublicProfile | null = profileFixture()) {
  const refreshAuth = vi.fn().mockResolvedValue(undefined);
  const refetchProfile = vi.fn();
  const harness = renderHook(
    (props: { username: string; profile: PublicProfile | null }) =>
      useProfileEdit({ ...props, refreshAuth, refetchProfile }),
    { initialProps: { username: "ana", profile } }
  );
  return { ...harness, refreshAuth, refetchProfile };
}

beforeEach(() => {
  (updateMyProfile as Mock).mockReset();
});

describe("useProfileEdit", () => {
  it("seeds drafts from the profile on startEditing", () => {
    const { result } = setup();
    act(() => result.current.startEditing());
    expect(result.current.editing).toBe(true);
    expect(result.current.draftBio).toBe("OSINT analyst.");
    expect(result.current.draftAvatarUrl).toBe("https://cdn.example/a.png");
    expect(result.current.draftLinks).toEqual({ x: "@ana" });
  });

  it("seeds empty strings for a profile without bio or avatar", () => {
    const { result } = setup(profileFixture({ bio: null, avatar_url: null }));
    act(() => result.current.startEditing());
    expect(result.current.draftBio).toBe("");
    expect(result.current.draftAvatarUrl).toBe("");
  });

  it("cancelEditing discards without saving", () => {
    const { result } = setup();
    act(() => result.current.startEditing());
    act(() => result.current.setDraftBio("changed"));
    act(() => result.current.cancelEditing());
    expect(result.current.editing).toBe(false);
    expect(updateMyProfile).not.toHaveBeenCalled();
  });

  it("saveEdits sends the wholesale-replace links payload and syncs", async () => {
    (updateMyProfile as Mock).mockResolvedValue({});
    const { result, refreshAuth, refetchProfile } = setup();
    act(() => result.current.startEditing());
    act(() => result.current.setDraftBio("new bio"));
    act(() => result.current.setDraftAvatarUrl(""));
    // Clearing every platform but X must null the others explicitly —
    // the backend treats external_links as wholesale-replace.
    act(() => result.current.setDraftLinks({ x: "@new" }));
    await act(async () => {
      await result.current.saveEdits();
    });
    expect(updateMyProfile).toHaveBeenCalledWith({
      bio: "new bio",
      avatar_url: "",
      external_links: { x: "@new", discord: null, website: null, github: null },
    });
    expect(refreshAuth).toHaveBeenCalledTimes(1);
    expect(refetchProfile).toHaveBeenCalledTimes(1);
    expect(result.current.editing).toBe(false);
  });

  it("a failed save keeps edit mode and surfaces the API message", async () => {
    (updateMyProfile as Mock).mockRejectedValue(
      new Error("Avatar URL must use http(s)")
    );
    const { result, refetchProfile } = setup();
    act(() => result.current.startEditing());
    await act(async () => {
      await result.current.saveEdits();
    });
    expect(result.current.saveError).toBe("Avatar URL must use http(s)");
    expect(result.current.editing).toBe(true);
    expect(result.current.saving).toBe(false);
    expect(refetchProfile).not.toHaveBeenCalled();
  });

  it("switching usernames exits edit mode", () => {
    const { result, rerender } = setup();
    act(() => result.current.startEditing());
    expect(result.current.editing).toBe(true);
    rerender({ username: "other", profile: profileFixture({ username: "other" }) });
    expect(result.current.editing).toBe(false);
  });

  it("flags bio overflow past the cap", () => {
    const { result } = setup();
    act(() => result.current.startEditing());
    act(() => result.current.setDraftBio("x".repeat(BIO_MAX_LEN + 1)));
    expect(result.current.bioOver).toBe(true);
    expect(result.current.bioRemaining).toBe(-1);
  });
});
