"use client";

import { Pencil } from "lucide-react";

import { formatDate } from "@/lib/format";
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
    <>
      {bio && <p>{bio}</p>}
      {segments.length > 0 && (
        <p
          className={`flex flex-wrap items-center text-xs text-neutral-500 ${bio ? "mt-1" : ""}`}
        >
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
      {/* `mt-1` only when a line precedes it: alone it is the slot's only
          line and needs no lead. */}
      {email && (
        <p className={`text-xs text-neutral-500 ${bio || segments.length ? "mt-1" : ""}`}>
          {email}
        </p>
      )}
    </>
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
