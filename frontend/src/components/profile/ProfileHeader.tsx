"use client";

import { Pencil } from "lucide-react";

import { formatDate } from "@/lib/format";
import type { PublicProfile } from "@/lib/users";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { FileManager } from "@/components/ui/FileManager";
import { FORM_ERROR_BANNER, FORM_LABEL } from "@/components/ui/form-styles";
import { ACCEPTED_IMAGE_MIME } from "@/lib/mediaTypes";
import FollowButton from "./FollowButton";
import { LinkedAccountsLine } from "./LinkedAccounts";
import type { ProfileEditState } from "./useProfileEdit";

/** The page title: avatar and handle (H1; `<PageShell>` owns the heading markup). The avatar is
 * `edit.avatarPreview`, falling back to the icon if it resolves to nothing, and `aria-hidden` (the
 * handle is the accessible name; otherwise the heading reads the alt text first). */
export function ProfileTitle({
  profile,
  edit,
}: {
  profile: PublicProfile;
  edit: ProfileEditState;
}) {
  // `avatarPreview` is the hook's one derivation, shared with the picker. A staged pick still being
  // read has no url yet and renders the icon.
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
      {/* Wraps rather than truncates: the action cluster leaves the title little room, and a clipped
          handle is the one thing to keep. */}
      <span className="min-w-0 break-words">{profile.username}</span>
    </span>
  );
}

/**
 * The lines under the handle: the analyst's own framing (bio), then account metadata, then the
 * account's email on your own profile. `<PageShell>` owns the slot and its
 * `[overflow-wrap:anywhere]`, which keeps a bio holding a bare URL or an email inside the frame on
 * a phone.
 *
 * The bio: empty renders nothing; a link is plain text that breaks where it must; long wraps
 * rather than clamps (`BIO_MAX_LEN` caps it at 500, and an ellipsis would hide the analyst's
 * framing). Typed line breaks collapse into the flow here and stay in the edit field.
 *
 * `meta` is the followers / following / member-since line, secondary text rather than tiles (the
 * work figures live in the Insights card). Zero values print. Each segment holds together so the
 * row wraps between segments at 375 px. `null` drops the line, as edit mode does.
 *
 * One `space-y-1` on the wrapper owns the spacing, so a line that drops out leaves no gap.
 */
export function ProfileIdentity({
  bio,
  email,
  meta,
}: {
  bio: string | null;
  email?: string;
  meta: PublicProfile | null;
}) {
  const segments = meta
    ? [
        `${meta.followers_count} follower${meta.followers_count === 1 ? "" : "s"}`,
        `${meta.following_count} following`,
        `Member since ${formatDate(meta.created_at)}`,
      ]
    : [];

  return (
    <div className="space-y-1">
      {bio && <p>{bio}</p>}
      {segments.length > 0 && (
        <p className="flex flex-wrap items-center text-xs text-neutral-500">
          {segments.map((segment, i) => (
            <span key={segment} className="whitespace-nowrap">
              {i > 0 && (
                <span aria-hidden="true" className="px-1.5 text-neutral-700">
                  ·
                </span>
              )}
              {segment}
            </span>
          ))}
        </p>
      )}
      {email && <p className="text-xs text-neutral-500">{email}</p>}
    </div>
  );
}

/** The header action cluster: the icon row (linked accounts, then Edit profile on your own
 * profile), and Follow on someone else's or the save pair while editing. The marks sit right of
 * the title, where pages keep controls that act on their subject: ghost icon buttons throughout,
 * Edit profile included. `gap-1.5` matches the event page's action cluster; the cluster's `gap-2`
 * separates the row from the far-right button. It wraps and right-aligns, so on a phone marks and
 * button break onto separate lines. Editing drops the row: the inputs below are the links, and the
 * page is already in edit mode. */
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
    <div className="flex flex-wrap items-center justify-end gap-2">
      {!edit.editing && (
        <div className="flex flex-wrap items-center gap-1.5">
          <LinkedAccountsLine profile={profile} />
          {isOwn && (
            <Button
              icon
              variant="ghost"
              onClick={edit.startEditing}
              aria-label="Edit profile"
              title="Edit profile"
            >
              <Pencil size={14} />
            </Button>
          )}
        </div>
      )}
      {isOwn
        ? edit.editing && (
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
          )
        : (
            <FollowButton
              username={profile.username}
              initialFollowing={profile.is_following}
            />
          )}
    </div>
  );
}

/** Edit-mode fields that belong to the header rather than a section card: the avatar picker and
 * the save-error banner. Nothing in view mode. The picker is the shared `FileManager` in
 * single-file image mode: its remove control drops the picture, and its drop zone returns once
 * none is staged. */
export function ProfileHeaderEditFields({
  profile,
  edit,
}: {
  profile: PublicProfile;
  edit: ProfileEditState;
}) {
  if (!edit.editing && !edit.saveError) return null;

  // The same derivation the title reads. A staged file always renders as a tile, url or not: what
  // Save uploads must be what the picker shows.
  const shown = edit.avatarPreview;
  const item =
    shown.kind === "staged"
      ? {
          // Identity of the pick, not of its bytes: a data URL re-keys the tile the moment the read lands.
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
