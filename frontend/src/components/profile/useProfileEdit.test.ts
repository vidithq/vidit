import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  BIO_MAX_LEN,
  useProfileEdit,
  type ProfileEditState,
} from "./useProfileEdit";
import {
  deleteMyAvatar,
  updateMyProfile,
  uploadMyAvatar,
  type PublicProfile,
} from "@/lib/users";

vi.mock("@/lib/users", () => ({
  updateMyProfile: vi.fn(),
  uploadMyAvatar: vi.fn(),
  deleteMyAvatar: vi.fn(),
}));

const pickedFile = () => new File(["bytes"], "me.jpg", { type: "image/jpeg" });

// The preview is read off the file asynchronously (FileReader), so a test that
// asserts on it has to let the microtask land first.
const flushPreview = async (result: { current: ProfileEditState }) => {
  await waitFor(() =>
    expect(
      result.current.avatarPreview.kind === "staged" &&
        result.current.avatarPreview.url,
    ).toBeTruthy(),
  );
};

function profileFixture(overrides: Partial<PublicProfile> = {}): PublicProfile {
  return {
    id: "p1",
    username: "ana",
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
    { initialProps: { username: "ana", profile } },
  );
  return { ...harness, refreshAuth, refetchProfile };
}

beforeEach(() => {
  (updateMyProfile as Mock).mockReset();
  (uploadMyAvatar as Mock).mockReset();
  (deleteMyAvatar as Mock).mockReset();
});

describe("useProfileEdit", () => {
  it("seeds drafts from the profile on startEditing", () => {
    const { result } = setup();
    act(() => result.current.startEditing());
    expect(result.current.editing).toBe(true);
    expect(result.current.draftBio).toBe("OSINT analyst.");
    expect(result.current.draftLinks).toEqual({ x: "@ana" });
    // The stored picture is not a draft: nothing is staged until a file is
    // picked, and every surface reads the stored URL through `avatarPreview`.
    expect(result.current.draftAvatarFile).toBeNull();
    expect(result.current.removeAvatar).toBe(false);
    expect(result.current.avatarPreview).toEqual({
      kind: "stored",
      url: "https://cdn.example/a.png",
    });
  });

  it("seeds an empty bio for a profile without one", () => {
    const { result } = setup(profileFixture({ bio: null, avatar_url: null }));
    act(() => result.current.startEditing());
    expect(result.current.draftBio).toBe("");
  });

  it("cancelEditing discards without saving", () => {
    const { result } = setup();
    act(() => result.current.startEditing());
    act(() => result.current.setDraftBio("changed"));
    act(() => result.current.setDraftAvatarFile(pickedFile()));
    act(() => result.current.cancelEditing());
    expect(result.current.editing).toBe(false);
    expect(result.current.draftAvatarFile).toBeNull();
    expect(updateMyProfile).not.toHaveBeenCalled();
    expect(uploadMyAvatar).not.toHaveBeenCalled();
  });

  it("saveEdits sends the wholesale-replace links payload and syncs", async () => {
    (updateMyProfile as Mock).mockResolvedValue({});
    const { result, refreshAuth, refetchProfile } = setup();
    act(() => result.current.startEditing());
    act(() => result.current.setDraftBio("new bio"));
    // Clearing every platform but X must null the others explicitly —
    // the backend treats external_links as wholesale-replace.
    act(() => result.current.setDraftLinks({ x: "@new" }));
    await act(async () => {
      await result.current.saveEdits();
    });
    expect(updateMyProfile).toHaveBeenCalledWith({
      bio: "new bio",
      external_links: { x: "@new", discord: null, website: null, github: null },
    });
    // Untouched picture: neither avatar call fires.
    expect(uploadMyAvatar).not.toHaveBeenCalled();
    expect(deleteMyAvatar).not.toHaveBeenCalled();
    expect(refreshAuth).toHaveBeenCalledTimes(1);
    expect(refetchProfile).toHaveBeenCalledTimes(1);
    expect(result.current.editing).toBe(false);
  });

  it("a staged file uploads after the PATCH", async () => {
    (updateMyProfile as Mock).mockResolvedValue({});
    (uploadMyAvatar as Mock).mockResolvedValue({});
    const file = pickedFile();
    const { result } = setup();
    act(() => result.current.startEditing());
    act(() => result.current.setDraftAvatarFile(file));
    // A staged pick is the shown state from the moment it is picked, before
    // its bytes are read: what Save uploads has to be what the picker shows.
    expect(result.current.avatarPreview).toEqual({
      kind: "staged",
      file,
      url: null,
    });
    // A `data:` URL, not a `blob:` one: nothing to revoke, so Strict Mode's
    // extra cleanup pass cannot kill the painted preview.
    await flushPreview(result);
    expect(result.current.avatarPreview).toEqual({
      kind: "staged",
      file,
      url: expect.stringMatching(/^data:image\/jpeg;base64,/),
    });
    await act(async () => {
      await result.current.saveEdits();
    });
    expect(uploadMyAvatar).toHaveBeenCalledWith(file);
    expect(deleteMyAvatar).not.toHaveBeenCalled();
    expect(result.current.draftAvatarFile).toBeNull();
  });

  it("removing the picture deletes it on save", async () => {
    (updateMyProfile as Mock).mockResolvedValue({});
    (deleteMyAvatar as Mock).mockResolvedValue({});
    const { result } = setup();
    act(() => result.current.startEditing());
    act(() => result.current.removeShownAvatar());
    expect(result.current.removeAvatar).toBe(true);
    expect(result.current.avatarPreview).toEqual({ kind: "none" });
    await act(async () => {
      await result.current.saveEdits();
    });
    expect(deleteMyAvatar).toHaveBeenCalledTimes(1);
    expect(uploadMyAvatar).not.toHaveBeenCalled();
    expect(result.current.removeAvatar).toBe(false);
  });

  it("picking a replacement after a removal uploads instead of deleting", async () => {
    (updateMyProfile as Mock).mockResolvedValue({});
    (uploadMyAvatar as Mock).mockResolvedValue({});
    const file = pickedFile();
    const { result } = setup();
    act(() => result.current.startEditing());
    act(() => result.current.removeShownAvatar());
    act(() => result.current.setDraftAvatarFile(file));
    expect(result.current.removeAvatar).toBe(false);
    await act(async () => {
      await result.current.saveEdits();
    });
    expect(uploadMyAvatar).toHaveBeenCalledWith(file);
    expect(deleteMyAvatar).not.toHaveBeenCalled();
  });

  it("a failed save keeps edit mode and surfaces the API message", async () => {
    (updateMyProfile as Mock).mockRejectedValue(
      new Error("bio must be 500 characters or fewer"),
    );
    const { result, refetchProfile } = setup();
    act(() => result.current.startEditing());
    await act(async () => {
      await result.current.saveEdits();
    });
    expect(result.current.saveError).toBe(
      "bio must be 500 characters or fewer",
    );
    expect(result.current.editing).toBe(true);
    expect(result.current.saving).toBe(false);
    // Re-read on failure: part of the save may have landed, and the form
    // must show what is persisted rather than a draft the server took.
    expect(refetchProfile).toHaveBeenCalledTimes(1);
  });

  it("a rejected picture keeps edit mode and the staged file", async () => {
    (updateMyProfile as Mock).mockResolvedValue({});
    (uploadMyAvatar as Mock).mockRejectedValue(
      new Error("File type video/mp4 not allowed for an avatar"),
    );
    const file = pickedFile();
    const { result, refetchProfile } = setup();
    act(() => result.current.startEditing());
    act(() => result.current.setDraftAvatarFile(file));
    await act(async () => {
      await result.current.saveEdits();
    });
    expect(result.current.saveError).toBe(
      "File type video/mp4 not allowed for an avatar",
    );
    expect(result.current.editing).toBe(true);
    expect(result.current.draftAvatarFile).toBe(file);
    // The bio PATCH landed before the avatar call threw; re-read so the
    // form reflects it.
    expect(refetchProfile).toHaveBeenCalledTimes(1);
  });

  it("the remove control un-stages a pick instead of deleting the stored one", async () => {
    (updateMyProfile as Mock).mockResolvedValue({});
    const { result } = setup();
    act(() => result.current.startEditing());
    act(() => result.current.setDraftAvatarFile(pickedFile()));
    // X on a staged tile means "not that one after all", so the stored picture
    // comes back and nothing is marked for deletion.
    act(() => result.current.removeShownAvatar());
    expect(result.current.draftAvatarFile).toBeNull();
    expect(result.current.removeAvatar).toBe(false);
    expect(result.current.avatarPreview).toEqual({
      kind: "stored",
      url: "https://cdn.example/a.png",
    });

    await act(async () => {
      await result.current.saveEdits();
    });
    expect(deleteMyAvatar).not.toHaveBeenCalled();
    expect(uploadMyAvatar).not.toHaveBeenCalled();
  });

  it("removing a picture the profile never had sends no DELETE", async () => {
    (updateMyProfile as Mock).mockResolvedValue({});
    const { result } = setup(profileFixture({ avatar_url: null }));
    act(() => result.current.startEditing());
    act(() => result.current.removeShownAvatar());
    await act(async () => {
      await result.current.saveEdits();
    });
    // Nothing stored, nothing to delete: the call would 200 and change
    // nothing, so it is not made.
    expect(deleteMyAvatar).not.toHaveBeenCalled();
  });

  it("the saved picture is adopted before edit mode closes", async () => {
    (updateMyProfile as Mock).mockResolvedValue({});
    (uploadMyAvatar as Mock).mockResolvedValue({
      avatar_url: "https://media.example/avatars/u/new.jpg",
    });
    const { result } = setup();
    act(() => result.current.startEditing());
    act(() => result.current.setDraftAvatarFile(pickedFile()));
    await act(async () => {
      await result.current.saveEdits();
    });
    // `profile` still carries the old URL until the refetch lands, so reading
    // it here is what would flash the replaced picture in the header.
    expect(result.current.editing).toBe(false);
    expect(result.current.avatarPreview).toEqual({
      kind: "stored",
      url: "https://media.example/avatars/u/new.jpg",
    });
  });

  it("a removed picture is gone from the header before the refetch lands", async () => {
    (updateMyProfile as Mock).mockResolvedValue({});
    (deleteMyAvatar as Mock).mockResolvedValue({ avatar_url: null });
    const { result } = setup();
    act(() => result.current.startEditing());
    act(() => result.current.removeShownAvatar());
    await act(async () => {
      await result.current.saveEdits();
    });
    expect(deleteMyAvatar).toHaveBeenCalledTimes(1);
    expect(result.current.avatarPreview).toEqual({ kind: "none" });
  });

  it("a failed save re-reads the profile, since the bio PATCH may have landed", async () => {
    (updateMyProfile as Mock).mockResolvedValue({});
    (uploadMyAvatar as Mock).mockRejectedValue(new Error("nope"));
    const { result, refetchProfile } = setup();
    act(() => result.current.startEditing());
    act(() => result.current.setDraftAvatarFile(pickedFile()));
    await act(async () => {
      await result.current.saveEdits();
    });
    expect(refetchProfile).toHaveBeenCalledTimes(1);
    expect(result.current.editing).toBe(true);
  });

  it("switching usernames exits edit mode", () => {
    const { result, rerender } = setup();
    act(() => result.current.startEditing());
    expect(result.current.editing).toBe(true);
    rerender({
      username: "other",
      profile: profileFixture({ username: "other" }),
    });
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
