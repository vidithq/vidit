"use client";

import {
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { updateMyProfile, type PublicProfile } from "@/lib/users";
import { useMutation } from "@/hooks/useMutation";
import type { ExternalLinks } from "@/types";

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

export interface ProfileEditState {
  editing: boolean;
  draftBio: string;
  setDraftBio: (v: string) => void;
  draftAvatarUrl: string;
  setDraftAvatarUrl: (v: string) => void;
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
 */
export function useProfileEdit({
  username,
  profile,
  refreshAuth,
  refetchProfile,
}: UseProfileEditArgs): ProfileEditState {
  const [editing, setEditing] = useState(false);
  const [draftBio, setDraftBio] = useState("");
  const [draftAvatarUrl, setDraftAvatarUrl] = useState("");
  const [draftLinks, setDraftLinks] = useState<ExternalLinks>({});

  const saveMutation = useMutation(
    () =>
      // Backend wholesale-replaces `external_links`. Send every platform
      // explicitly (null for empty) so cleared ones aren't left stale in JSONB.
      updateMyProfile({
        bio: draftBio,
        avatar_url: draftAvatarUrl,
        external_links: {
          x: draftLinks.x ?? null,
          discord: draftLinks.discord ?? null,
          website: draftLinks.website ?? null,
          github: draftLinks.github ?? null,
        },
      }),
    {
      fallback: "Failed to save",
      onSuccess: async () => {
        await refreshAuth();
        refetchProfile();
        setEditing(false);
      },
    }
  );
  const saving = saveMutation.loading;
  const saveError = saveMutation.error;
  // Stable `useState` setter — safe to omit from effect deps, like the old
  // local `setSaveError`.
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
    setDraftAvatarUrl(profile.avatar_url ?? "");
    setDraftLinks(profile.external_links ?? {});
    setSaveError(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setSaveError(null);
  };

  const saveEdits = async () => {
    await saveMutation.run();
  };

  const bioRemaining = BIO_MAX_LEN - draftBio.length;
  const bioOver = bioRemaining < 0;

  return {
    editing,
    draftBio,
    setDraftBio,
    draftAvatarUrl,
    setDraftAvatarUrl,
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
