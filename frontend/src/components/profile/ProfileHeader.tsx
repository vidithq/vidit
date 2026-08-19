"use client";

import { Pencil } from "lucide-react";

import { formatDate } from "@/lib/format";
import type { PublicProfile } from "@/lib/users";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { FileManager } from "@/components/ui/FileManager";
import { Glyph } from "@/components/ui/Glyph";
import { FORM_ERROR_BANNER, FORM_LABEL } from "@/components/ui/form-styles";
import { ACCEPTED_IMAGE_MIME } from "@/lib/mediaTypes";
import FollowButton from "./FollowButton";
import { LinkedAccountsLine } from "./LinkedAccounts";
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

/**
 * The lines under the handle: the analyst's own framing, then the account
 * metadata, then the account's email on your own profile.
 *
 * The bio reads here rather than in a card of its own, so a visitor meets the
 * identity as one compact block (picture, handle, one line of prose) and the
 * evidence starts immediately below it. `<PageShell>` owns the slot and its
 * `[overflow-wrap:anywhere]`, which is what keeps a bio holding a bare URL, or
 * an email that is one unbreakable token, inside the frame on a phone.
 *
 * The bio has three shapes, each deliberate. **Empty:** it renders nothing, so
 * the handle sits over the metadata line alone. **With a link:** the URL is
 * plain text that breaks where it must. **Long:** it wraps instead of
 * clamping. `BIO_MAX_LEN` already caps it at 500 characters, and hiding the
 * tail behind an ellipsis would drop the analyst's own framing with nothing
 * offering to reveal it. Line breaks the author typed collapse into the flow,
 * so a multi-paragraph bio reads as one line of prose here and keeps its shape
 * in the edit field.
 *
 * `meta` is the followers / following / member-since line: social and account
 * age, which say who the analyst is rather than what they documented. It reads
 * as secondary text inside the identity block instead of as tiles, because a
 * grid weighing as much as the Insights card is a grid claiming to say as
 * much. The work figures have one home, the Insights card. Zero values print:
 * a profile that hides its zeros is one whose numbers cannot be read at all.
 * Each segment holds together on its own line, so the row wraps between
 * segments rather than inside one at 375 px. Passing `null` drops the line,
 * which is what edit mode does: the page collapses to the form there.
 *
 * One `space-y-1` on the wrapper owns the spacing between every line here, so a
 * line that drops out leaves no gap behind it.
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

/** The header action cluster: the glyph row (the linked accounts, then Edit
 *  profile on your own profile), and Follow on someone else's or the save pair
 *  while editing.
 *
 *  Reaching the analyst is an action on the page rather than a line of the
 *  identity, so the marks sit where every other page keeps the controls that
 *  act on the thing the page is about, right of the title. One shape for the
 *  whole row: `<Glyph>` marks, the owner's Edit profile included, so the header
 *  offers one kind of control rather than four marks beside a button. The row
 *  keeps its own `gap-2` and the cluster's `gap-2` separates it from whatever
 *  button sits at the far right. The cluster wraps and right-aligns, the shape
 *  every page-level action cluster uses, so the marks and the button break onto
 *  separate lines on a phone instead of widening the header.
 *
 *  Editing drops the row: the links are the inputs below for the duration, and
 *  the page is already in the mode Edit profile would enter. */
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
        <div className="flex flex-wrap items-center gap-2">
          <LinkedAccountsLine profile={profile} />
          {isOwn && (
            <Glyph icon={Pencil} label="Edit profile" onClick={edit.startEditing} />
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
