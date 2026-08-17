"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

import {
  deleteMyAvatar,
  updateMyProfile,
  uploadMyAvatar,
  type PublicProfile,
} from "@/lib/users";
import { fileToDataUrl } from "@/lib/files";
import { useMutation } from "@/hooks/useMutation";
import type { ExternalLinks } from "@/types";

// Bio ceiling, mirroring the backend BIO_MAX_LEN in schemas/user.py so the
// counter and the textarea cap read the same limit the API enforces.
export const BIO_MAX_LEN = 500;

interface UseProfileEditArgs {
  /** Route param — leaving for another profile exits edit mode. */
  username: string;
  profile: PublicProfile | null;
  /** Refresh AuthContext so the sidebar / other surfaces pick up the
   *  new avatar + bio without a hard reload. */
  refreshAuth: () => Promise<void>;
  /** Re-fetch the profile so view mode reflects the saved values. */
  refetchProfile: () => void;
}

/**
 * What the profile-picture surfaces should render right now. One derivation,
 * read by the header title and by the picker, so the two cannot disagree about
 * whether a pick or the stored picture is winning.
 *
 * `staged` carries a null `url` while the file's bytes are still being read:
 * the surfaces must still show a staged state then, because what Save uploads
 * is the file, not whatever is stored.
 */
export type AvatarPreview =
  | { kind: "staged"; file: File; url: string | null }
  | { kind: "stored"; url: string }
  | { kind: "none" };

export interface ProfileEditState {
  editing: boolean;
  draftBio: string;
  setDraftBio: (v: string) => void;
  /** The picked image awaiting upload, or null when none is staged. */
  draftAvatarFile: File | null;
  /** Stage a picked file, replacing any previous pick. */
  setDraftAvatarFile: (file: File | null) => void;
  /** Drop the picture on save: true once the analyst removes the stored one
   *  and has not picked a replacement. */
  removeAvatar: boolean;
  /** What the header title and the picker render. */
  avatarPreview: AvatarPreview;
  /** The picker's remove control. Un-stages a pick (back to the stored
   *  picture); on the stored picture itself, marks it for deletion on save. */
  removeShownAvatar: () => void;
  draftLinks: ExternalLinks;
  setDraftLinks: Dispatch<SetStateAction<ExternalLinks>>;
  saving: boolean;
  saveError: string | null;
  bioRemaining: number;
  bioOver: boolean;
  startEditing: () => void;
  cancelEditing: () => void;
  saveEdits: () => Promise<void>;
}

/**
 * Inline-edit state machine for the own-profile page. Drafts are seeded from
 * the live profile on entering edit mode, discarded on cancel; saving PATCHes
 * /users/me and re-fetches rather than treating local drafts as canonical.
 *
 * The picture is a file, not a URL: it saves through its own endpoint after
 * the PATCH, because it is stored rather than stringified into a column. A
 * pick beats a removal (picking a replacement is what an analyst does after
 * clearing the old one), so the two never both fire.
 */
export function useProfileEdit({
  username,
  profile,
  refreshAuth,
  refetchProfile,
}: UseProfileEditArgs): ProfileEditState {
  const [editing, setEditing] = useState(false);
  const [draftBio, setDraftBio] = useState("");
  const [draftAvatarFile, setDraftAvatarFile] = useState<File | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  // The avatar the last successful save produced. `refetchProfile` only bumps
  // a counter, so `profile.avatar_url` still holds the previous value for a
  // beat after saving, which is exactly when the header would flash the
  // picture the save just replaced or removed. Tagged with the profile it came
  // from, so navigating to another analyst reads their column rather than this
  // one's leftover.
  const [savedAvatar, setSavedAvatar] = useState<{
    username: string;
    url: string | null;
  } | null>(null);
  const [draftLinks, setDraftLinks] = useState<ExternalLinks>({});

  // Preview for the staged file, as a `data:` URL rather than a `blob:` one
  // (see `lib/files.fileToDataUrl` for why: a blob URL's revoke lands in this
  // effect's cleanup, which Strict Mode runs once right after the first
  // commit, leaving the painted preview pointing at a dead reference). Reading
  // the bytes is async, so `cancelled` drops a result the pick has already
  // superseded.
  const [draftAvatarPreview, setDraftAvatarPreview] = useState<string | null>(
    null,
  );
  useEffect(() => {
    if (!draftAvatarFile) return;
    let cancelled = false;
    void fileToDataUrl(draftAvatarFile).then(
      (url) => {
        if (!cancelled) setDraftAvatarPreview(url);
      },
      () => {
        // Unreadable file: fall back to the stored picture rather than a
        // broken preview. The upload itself still surfaces its own error.
        if (!cancelled) setDraftAvatarPreview(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [draftAvatarFile]);

  // Unstaging clears the preview here rather than in the effect above: the
  // effect body would be setting state synchronously on every render that
  // carries no file, and the four call sites that drop the pick are the only
  // way to reach that case.
  const dropStagedAvatar = () => {
    setDraftAvatarFile(null);
    setDraftAvatarPreview(null);
  };

  const saveMutation = useMutation(
    async () => {
      // Backend wholesale-replaces `external_links`. Send every platform
      // explicitly (null for empty) so cleared ones aren't left stale in JSONB.
      await updateMyProfile({
        bio: draftBio,
        external_links: {
          x: draftLinks.x ?? null,
          discord: draftLinks.discord ?? null,
          website: draftLinks.website ?? null,
          github: draftLinks.github ?? null,
        },
      });
      // After the PATCH so a rejected bio doesn't leave a stored image behind
      // that the profile never adopted. Removing is only a call when there is
      // something stored to remove.
      if (draftAvatarFile) {
        return (await uploadMyAvatar(draftAvatarFile)).avatar_url ?? null;
      }
      if (removeAvatar && profile?.avatar_url) {
        return (await deleteMyAvatar()).avatar_url ?? null;
      }
      // Picture untouched: leave whatever the profile already carries.
      return undefined;
    },
    {
      fallback: "Failed to save",
      onSuccess: async (avatarUrl) => {
        // Adopt the saved picture before leaving edit mode, so the header
        // never renders the old one between the save and the refetch.
        if (avatarUrl !== undefined)
          setSavedAvatar({ username, url: avatarUrl });
        await refreshAuth();
        refetchProfile();
        dropStagedAvatar();
        setRemoveAvatar(false);
        setEditing(false);
      },
      onError: () => {
        // The bio PATCH may have landed before the avatar call threw. Re-read
        // so the form shows what is actually persisted rather than a draft the
        // server already has. Returning undefined keeps the default message.
        refetchProfile();
        return undefined;
      },
    },
  );
  const saving = saveMutation.loading;
  const saveError = saveMutation.error;
  // Stable `useState` setter, safe to omit from effect deps.
  const setSaveError = saveMutation.setError;

  // Drop edit mode when the profile switches usernames, so unsaved drafts
  // don't leak into another profile.
  useEffect(() => {
    setEditing(false);
    setSaveError(null);
  }, [username, setSaveError]);

  const startEditing = () => {
    // The edit affordance renders only once the profile loads; guard keeps the
    // seed read type-safe.
    if (!profile) return;
    setDraftBio(profile.bio ?? "");
    dropStagedAvatar();
    setRemoveAvatar(false);
    setSavedAvatar(null);
    setDraftLinks(profile.external_links ?? {});
    setSaveError(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    dropStagedAvatar();
    setRemoveAvatar(false);
    setSaveError(null);
  };

  const stageAvatarFile = (file: File | null) => {
    if (file) setDraftAvatarFile(file);
    else dropStagedAvatar();
    // A fresh pick supersedes a pending removal; dropping the pick falls back
    // to whatever the profile already holds.
    setRemoveAvatar(false);
  };

  const removeShownAvatar = () => {
    // A staged pick is what the tile is showing, so the X un-stages it and the
    // stored picture comes back. Only the stored picture itself can be marked
    // for deletion, which is the one case that reaches DELETE on save.
    const wasStaged = draftAvatarFile !== null;
    dropStagedAvatar();
    if (!wasStaged) setRemoveAvatar(true);
  };

  // One derivation for every surface (see `AvatarPreview`).
  const storedAvatarUrl =
    savedAvatar && savedAvatar.username === username
      ? savedAvatar.url
      : (profile?.avatar_url ?? null);
  const stored: AvatarPreview = storedAvatarUrl
    ? { kind: "stored", url: storedAvatarUrl }
    : { kind: "none" };
  let avatarPreview: AvatarPreview = stored;
  if (editing) {
    if (draftAvatarFile) {
      avatarPreview = {
        kind: "staged",
        file: draftAvatarFile,
        url: draftAvatarPreview,
      };
    } else if (removeAvatar) {
      avatarPreview = { kind: "none" };
    }
  }

  const saveEdits = async () => {
    await saveMutation.run();
  };

  const bioRemaining = BIO_MAX_LEN - draftBio.length;
  const bioOver = bioRemaining < 0;

  return {
    editing,
    draftBio,
    setDraftBio,
    draftAvatarFile,
    setDraftAvatarFile: stageAvatarFile,
    removeAvatar,
    avatarPreview,
    removeShownAvatar,
    draftLinks,
    setDraftLinks,
    saving,
    saveError,
    bioRemaining,
    bioOver,
    startEditing,
    cancelEditing,
    saveEdits,
  };
}
