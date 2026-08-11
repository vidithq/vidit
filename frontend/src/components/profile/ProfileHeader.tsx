"use client";

import { Pencil } from "lucide-react";

import type { PublicProfile } from "@/lib/users";
import FollowButton from "./FollowButton";
import { CopyProfileLink } from "./CopyProfileLink";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import {
  FORM_ERROR_BANNER,
  FORM_LABEL,
} from "@/components/ui/form-styles";
import { Input } from "@/components/ui/Input";
import type { ProfileEditState } from "./useProfileEdit";

/** The page title: avatar + handle. The analyst is what the page is about, so
 *  the handle is the H1 (the event detail page titles itself with the event
 *  the same way), and `<PageShell>` owns the heading markup.
 *
 *  Avatar shown is the draft preview in edit mode, the persisted URL
 *  otherwise; it falls back to the icon if neither resolves. It is decorative
 *  here (the handle next to it is the accessible name), hence `aria-hidden`:
 *  without it the heading reads the avatar's alt text before the handle. */
export function ProfileTitle({
  profile,
  edit,
}: {
  profile: PublicProfile;
  edit: ProfileEditState;
}) {
  const displayedAvatar = edit.editing ? edit.draftAvatarUrl : profile.avatar_url;
  return (
    <span className="flex items-center gap-3 min-w-0">
      <span aria-hidden="true" className="contents">
        <Avatar
          as="span"
          src={displayedAvatar}
          username={profile.username}
          size="w-11 h-11"
          fallback="icon"
        />
      </span>
      {/* Wraps rather than truncates: on a narrow screen the action cluster
          leaves the title little room, and a clipped handle is the one thing
          this page cannot afford to lose. */}
      <span className="min-w-0 break-words">{profile.username}</span>
    </span>
  );
}

/** The header action cluster: share on every profile, plus Follow (someone
 *  else's) or the edit / save pair (your own). */
export function ProfileActions({
  profile,
  isOwn,
  edit,
}: {
  profile: PublicProfile;
  isOwn: boolean;
  edit: ProfileEditState;
}) {
  return (
    <div className="flex items-center gap-2">
      <CopyProfileLink username={profile.username} />
      {isOwn ? (
        edit.editing ? (
          <>
            <Button
              variant="ghost"
              onClick={edit.cancelEditing}
              disabled={edit.saving}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={edit.saveEdits}
              disabled={edit.saving || edit.bioOver}
            >
              {edit.saving ? "Saving…" : "Save"}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={edit.startEditing}>
            <Pencil size={12} />
            Edit profile
          </Button>
        )
      ) : (
        <FollowButton
          username={profile.username}
          initialFollowing={profile.is_following}
        />
      )}
    </div>
  );
}

/** Edit-mode fields that belong to the header rather than to a section card:
 *  the avatar URL (it edits the picture in the title) and the save-error
 *  banner. Nothing in view mode. */
export function ProfileHeaderEditFields({ edit }: { edit: ProfileEditState }) {
  if (!edit.editing && !edit.saveError) return null;

  return (
    <>
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

      {edit.saveError && <div className={FORM_ERROR_BANNER}>{edit.saveError}</div>}
    </>
  );
}
