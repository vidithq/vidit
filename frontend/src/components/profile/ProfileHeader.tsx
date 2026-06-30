"use client";

import { Pencil } from "lucide-react";

import type { PublicProfile } from "@/lib/users";
import TrustBadge from "./TrustBadge";
import FollowButton from "./FollowButton";
import { Avatar } from "@/components/ui/Avatar";
import { NEUTRAL_BUTTON, PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/ui/styles";
import {
  FORM_ERROR_BANNER_BOXED,
  FORM_LABEL,
} from "@/components/ui/form-styles";
import { Input } from "@/components/ui/Input";
import type { ProfileEditState } from "./useProfileEdit";

interface ProfileHeaderProps {
  profile: PublicProfile;
  isOwn: boolean;
  /** Signed-in user's email — rendered only on the own profile. */
  email?: string;
  edit: ProfileEditState;
}

/** Identity card (avatar + username/trust/email + the Edit-or-Follow
 *  action cluster), plus the edit-mode avatar input and save-error
 *  banner that sit directly under it. */
export function ProfileHeader({ profile, isOwn, email, edit }: ProfileHeaderProps) {
  // Avatar shown is the draft preview in edit mode, the persisted URL
  // otherwise. Falls back to the icon if neither resolves.
  const displayedAvatar = edit.editing ? edit.draftAvatarUrl : profile.avatar_url;

  return (
    <>
      {/* Identity card. The user-specific identity lives here (not the page
          title) so own and others' profiles share the same chrome. */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <Avatar
            src={displayedAvatar}
            username={profile.username}
            size="w-16 h-16"
            fallback="icon"
          />
          <div className="min-w-0">
            {/* h2 under PageShell's generic "Profile" h1 so the username is
                exposed to screen readers and the document outline. */}
            <h2 className="text-base font-medium text-neutral-100 inline-flex items-center gap-2">
              {profile.username}
              <TrustBadge
                isTrusted={profile.is_trusted}
                trustReason={profile.trust_reason}
                size={14}
              />
            </h2>
            {isOwn && (
              <p className="text-sm text-neutral-400 mt-0.5 truncate">
                {email}
              </p>
            )}
          </div>
        </div>
        <div className="shrink-0">
          {isOwn ? (
            edit.editing ? (
              <div className="inline-flex gap-2">
                <button
                  type="button"
                  onClick={edit.cancelEditing}
                  disabled={edit.saving}
                  className={`px-3 py-1.5 rounded-md text-xs disabled:opacity-50 ${NEUTRAL_BUTTON}`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={edit.saveEdits}
                  disabled={edit.saving || edit.bioOver}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium disabled:opacity-50 ${PRIMARY_BUTTON}`}
                >
                  {edit.saving ? "Saving…" : "Save"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={edit.startEditing}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs ${SECONDARY_BUTTON}`}
              >
                <Pencil size={12} />
                Edit profile
              </button>
            )
          ) : (
            <FollowButton
              username={profile.username}
              initialFollowing={profile.is_following}
            />
          )}
        </div>
      </div>

      {/* Avatar URL input — below the avatar row so it sits next to what it
          edits. */}
      {edit.editing && (
        <div className="max-w-sm">
          <label className={FORM_LABEL} htmlFor="avatar-url">
            Avatar URL
          </label>
          <Input
            variant="compact"
            id="avatar-url"
            type="url"
            inputMode="url"
            placeholder="https://example.com/me.jpg"
            value={edit.draftAvatarUrl}
            onChange={(e) => edit.setDraftAvatarUrl(e.target.value)}
            className="mt-1"
          />
        </div>
      )}

      {edit.saveError && (
        <div className={FORM_ERROR_BANNER_BOXED}>
          {edit.saveError}
        </div>
      )}
    </>
  );
}
