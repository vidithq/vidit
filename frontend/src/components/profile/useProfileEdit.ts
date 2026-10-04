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

// Bio ceiling, mirrors the backend BIO_MAX_LEN in schemas/user.py; change both.
export const BIO_MAX_LEN = 500;

interface UseProfileEditArgs {
  /** Route param: leaving for another profile exits edit mode. */
  username: string;
  profile: PublicProfile | null;
  /** Refresh AuthContext so the sidebar and other surfaces pick up the new avatar and bio. */
  refreshAuth: () => Promise<void>;
  /** Re-fetch the profile so view mode reflects the saved values. */
  refetchProfile: () => void;
}

/** What the profile-picture surfaces render now: one derivation for the header title and the
 * picker. `staged` carries a null `url` while the file's bytes are read: surfaces still show a
 * staged state, since Save uploads the file, not what is stored. */
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
  /** Drop the picture on save: true once the stored one is removed and no replacement is picked. */
  removeAvatar: boolean;
  /** What the header title and the picker render. */
  avatarPreview: AvatarPreview;
  /** The picker's remove control: un-stages a pick, or marks the stored picture for deletion on save. */
  removeShownAvatar: () => void;
  draftLinks: ExternalLinks;
  setDraftLinks: Dispatch<SetStateAction<ExternalLinks>>;
  saving: boolean;
  saveError: string | null;
  bioOver: boolean;
  startEditing: () => void;
  cancelEditing: () => void;
  saveEdits: () => Promise<void>;
}

/**
 * Inline-edit state machine for the own-profile page. Drafts are seeded from the live profile on
 * entering edit mode and discarded on cancel; saving PATCHes /users/me and re-fetches rather than
 * treating drafts as canonical. The picture saves through its own endpoint after the PATCH. A pick
 * beats a removal, so the two never both fire.
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
  // The avatar the last successful save produced. `refetchProfile` only bumps a counter, so
  // `profile.avatar_url` is stale for a beat, when the header would flash the replaced picture.
  // Tagged with its profile so another analyst's page doesn't read this leftover.
  const [savedAvatar, setSavedAvatar] = useState<{
    username: string;
    url: string | null;
  } | null>(null);
  const [draftLinks, setDraftLinks] = useState<ExternalLinks>({});

  // Preview for the staged file as a `data:` URL, not `blob:` (see `lib/files.fileToDataUrl`: Strict
  // Mode runs the effect cleanup once after first commit and would revoke the blob under the painted
  // preview). Reading is async, so `cancelled` drops a superseded result.
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
        // Unreadable file: fall back to the stored picture; the upload surfaces its own error.
        if (!cancelled) setDraftAvatarPreview(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [draftAvatarFile]);

  // Unstaging clears the preview here, not in the effect above, which would set state
  // synchronously on every render with no file.
  const dropStagedAvatar = () => {
    setDraftAvatarFile(null);
    setDraftAvatarPreview(null);
  };

  const saveMutation = useMutation(
    async () => {
      // Backend wholesale-replaces `external_links`: send every platform (null for empty) so cleared
      // ones aren't left stale in JSONB.
      await updateMyProfile({
        bio: draftBio,
        external_links: {
          x: draftLinks.x ?? null,
          discord: draftLinks.discord ?? null,
          website: draftLinks.website ?? null,
          github: draftLinks.github ?? null,
        },
      });
      // After the PATCH so a rejected bio doesn't leave a stored image the profile never adopted.
      // Removing is a call only when something is stored.
      if (draftAvatarFile) {
        return (await uploadMyAvatar(draftAvatarFile)).avatar_url ?? null;
      }
      if (removeAvatar && profile?.avatar_url) {
        return (await deleteMyAvatar()).avatar_url ?? null;
      }
      return undefined;
    },
    {
      fallback: "Failed to save",
      onSuccess: async (avatarUrl) => {
        // Adopt the saved picture before leaving edit mode, so the header never shows the old one.
        if (avatarUrl !== undefined)
          setSavedAvatar({ username, url: avatarUrl });
        await refreshAuth();
        refetchProfile();
        dropStagedAvatar();
        setRemoveAvatar(false);
        setEditing(false);
      },
      onError: () => {
        // The bio PATCH may have landed before the avatar call threw: re-read so the form shows what is
        // persisted. Returning undefined keeps the default message.
        refetchProfile();
        return undefined;
      },
    },
  );
  const saving = saveMutation.loading;
  const saveError = saveMutation.error;
  // Stable `useState` setter, safe to omit from effect deps.
  const setSaveError = saveMutation.setError;

  // Drop edit mode when the profile switches usernames, so unsaved drafts don't leak.
  useEffect(() => {
    setEditing(false);
    setSaveError(null);
  }, [username, setSaveError]);

  const startEditing = () => {
    // The edit affordance renders only once the profile loads; the guard keeps the seed read type-safe.
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
    // A fresh pick supersedes a pending removal; dropping it falls back to the stored picture.
    setRemoveAvatar(false);
  };

  const removeShownAvatar = () => {
    // A staged pick is what the tile shows, so X un-stages it; only the stored picture can be marked
    // for deletion (the one case that reaches DELETE on save).
    const wasStaged = draftAvatarFile !== null;
    dropStagedAvatar();
    if (!wasStaged) setRemoveAvatar(true);
  };

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

  const bioOver = draftBio.length > BIO_MAX_LEN;

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
    bioOver,
    startEditing,
    cancelEditing,
    saveEdits,
  };
}
