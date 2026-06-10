"use client";

import {
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { updateMyProfile, type PublicProfile } from "@/lib/users";
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
 * Inline-edit state machine for the own-profile page. Drafts are seeded
 * from the live profile when entering edit mode and discarded on
 * cancel; saving PATCHes /users/me and re-fetches to keep view-mode
 * in sync without trusting the local drafts as canonical.
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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Drop edit mode whenever the visible profile switches usernames —
  // editing is always "this user, right now"; navigating away without
  // saving should not silently leak drafts into another profile.
  useEffect(() => {
    setEditing(false);
    setSaveError(null);
  }, [username]);

  const startEditing = () => {
    // The edit affordance only renders once the profile has loaded;
    // the guard keeps the seed read type-safe.
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
    setSaving(true);
    setSaveError(null);
    try {
      // Backend treats `external_links` as wholesale-replace. Sending each
      // platform explicitly (with null for empty) drops cleared platforms
      // instead of leaving stale values in the JSONB.
      await updateMyProfile({
        bio: draftBio,
        avatar_url: draftAvatarUrl,
        external_links: {
          x: draftLinks.x ?? null,
          discord: draftLinks.discord ?? null,
          website: draftLinks.website ?? null,
          github: draftLinks.github ?? null,
        },
      });
      await refreshAuth();
      refetchProfile();
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
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
