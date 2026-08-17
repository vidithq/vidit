"use client";

import { Pencil } from "lucide-react";

import type { PublicProfile } from "@/lib/users";
import FollowButton from "./FollowButton";
import { CopyProfileLink } from "./CopyProfileLink";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { FileManager } from "@/components/ui/FileManager";
import { FORM_ERROR_BANNER, FORM_LABEL } from "@/components/ui/form-styles";
import { ACCEPTED_IMAGE_MIME } from "@/lib/mediaTypes";
import type { ProfileEditState } from "./useProfileEdit";

/** The page title: avatar + handle. The analyst is what the page is about, so
 *  the handle is the H1 (the event detail page titles itself with the event
 *  the same way), and `<PageShell>` owns the heading markup.
 *
 *  Avatar shown is `edit.avatarPreview`, the one derivation the picker reads
 *  too; it falls back to the icon if it resolves to nothing. It is decorative
 *  here (the handle next to it is the accessible name), hence `aria-hidden`:
 *  without it the heading reads the avatar's alt text before the handle. */
export function ProfileTitle({
  profile,
  edit,
}: {
  profile: PublicProfile;
  edit: ProfileEditState;
}) {
  // `avatarPreview` is the hook's single derivation of what to show, shared
  // with the picker below. A staged pick whose bytes are still being read has
  // no url yet, which renders the icon rather than the picture it replaces.
  const displayedAvatar =
    edit.avatarPreview.kind === "none" ? null : edit.avatarPreview.url;
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
 *  the avatar picker (it edits the picture in the title) and the save-error
 *  banner. Nothing in view mode.
 *
 *  The picker is the shared `FileManager` in single-file image mode: its own
 *  remove control drops the picture, and its drop zone comes back once none is
 *  staged, so add and remove are the one primitive rather than two. */
export function ProfileHeaderEditFields({
  profile,
  edit,
}: {
  profile: PublicProfile;
  edit: ProfileEditState;
}) {
  if (!edit.editing && !edit.saveError) return null;

  // The same derivation the title reads. A staged file always renders as a
  // tile, url or not: what Save uploads has to be what the picker shows, so a
  // pick whose bytes are still being read names the file instead of falling
  // back to the picture it would replace.
  const shown = edit.avatarPreview;
  const item =
    shown.kind === "staged"
      ? {
          // Identity of the pick, not of its bytes: a data URL is a whole
          // encoded image and re-keys the tile the moment the read lands.
          key: `${shown.file.name}-${shown.file.size}-${shown.file.lastModified}`,
          content: shown.url ? (
            <Avatar
              src={shown.url}
              username={profile.username}
              size="w-20 h-20"
              fallback="icon"
              decorative
            />
          ) : (
            <span className="flex h-20 w-20 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900 px-2 text-center text-[10px] break-all text-neutral-400">
              {shown.file.name}
            </span>
          ),
        }
      : shown.kind === "stored"
        ? {
            key: "stored",
            content: (
              <Avatar
                src={shown.url}
                username={profile.username}
                size="w-20 h-20"
                fallback="icon"
                decorative
              />
            ),
          }
        : null;

  return (
    <>
      {edit.editing && (
        <div className="max-w-sm">
          <span className={FORM_LABEL}>Profile picture</span>
          <div className="mt-1">
            <FileManager
              items={
                item
                  ? [
                      {
                        ...item,
                        onRemove: edit.removeShownAvatar,
                        removeLabel: "Remove profile picture",
                      },
                    ]
                  : []
              }
              onAddFiles={(files) => edit.setDraftAvatarFile(files[0] ?? null)}
              accept={ACCEPTED_IMAGE_MIME}
              addLabel="Add a picture"
              addHint="JPEG, PNG or WebP. Stored on Vidit and resized."
              layout="stack"
            />
          </div>
        </div>
      )}

      {edit.saveError && (
        <div className={FORM_ERROR_BANNER}>{edit.saveError}</div>
      )}
    </>
  );
}
