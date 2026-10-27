"use client";

import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { FolderPlus, LogOut, Pencil } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { ARM_MS, useConfirmAction } from "@/hooks/useConfirmAction";
import { newCollectionHref } from "@/lib/collections";
import { countLabel, formatDate } from "@/lib/format";
import { splitLinks } from "@/lib/outbound";
import type { OrganizationMembership } from "@/lib/organizations";
import type { PublicProfile } from "@/lib/users";
import type { ExternalLinks } from "@/types";
import { Avatar } from "@/components/ui/Avatar";
import { Button, buttonClasses } from "@/components/ui/Button";
import { FileManager } from "@/components/ui/FileManager";
import { FORM_ERROR_BANNER, FORM_LABEL } from "@/components/ui/form-styles";
import { OutboundLink } from "@/components/ui/OutboundLink";
import { ARMED_RING, TEXT_LINK } from "@/components/ui/styles";
import { Tooltip } from "@/components/ui/Tooltip";
import { ACCEPTED_IMAGE_MIME } from "@/lib/mediaTypes";
import { LinkedAccountsLine } from "./LinkedAccounts";
import { ProfileOrganizations } from "./ProfileOrganizations";
import type { ProfileEditState } from "./useProfileEdit";

/** The page title: avatar and name, the analyst's handle or the organization's name (H1;
 * `<PageShell>` owns the heading markup). The avatar is `edit.avatarPreview`, falling back to the
 * icon if it resolves to nothing, and `aria-hidden` (the name is the accessible name; otherwise
 * the heading reads the alt text first). */
export function ProfileTitle({ name, edit }: { name: string; edit: ProfileEditState }) {
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
          username={name}
          size="w-11 h-11"
          fallback="icon"
        />
      </span>
      {/* Wraps rather than truncates: the action cluster leaves the title little room, and a clipped
          handle is the one thing to keep. */}
      <span className="min-w-0 break-words">{name}</span>
    </span>
  );
}

/**
 * The lines under the handle: the analyst's own framing (bio), then account metadata. `<PageShell>`
 * owns the slot and its `[overflow-wrap:anywhere]`, which keeps a bio holding a bare URL inside the
 * frame on a phone. Edit mode drops the block.
 *
 * The bio: empty renders nothing; an http(s) URL in it links through `<OutboundLink>` and breaks
 * where it must; long wraps rather than clamps (`BIO_MAX_LEN` caps it at 500, and an ellipsis
 * would hide the analyst's framing). Typed line breaks collapse into the flow here and stay in the edit field.
 *
 * The metadata is the followers / following / member-since line, secondary text rather than tiles
 * (the work figures live in the Insights card). Zero values print. Each segment holds together so
 * the row wraps between segments at 375 px. The analyst's organizations close the line as logos,
 * and an analyst in none shows no segment for them.
 */
export function ProfileIdentity({
  profile,
  organizations,
}: {
  profile: PublicProfile;
  organizations: OrganizationMembership[] | null;
}) {
  return (
    <IdentityLines
      bio={profile.bio}
      segments={[
        countLabel(profile.followers_count, "follower"),
        `${profile.following_count} following`,
        `Member since ${formatDate(profile.created_at)}`,
        ...(organizations?.length
          ? [<ProfileOrganizations key="organizations" memberships={organizations} />]
          : []),
      ]}
    />
  );
}

/** The bio, then the metadata segments joined by middots: the identity block of an analyst's
 * profile and of an organization's page. */
export function IdentityLines({ bio: rawBio, segments }: { bio: string | null; segments: ReactNode[] }) {
  const bio = rawBio?.trim() || null;

  return (
    <div className="space-y-1">
      {bio && (
        <p>
          {splitLinks(bio).map(({ text, href }, i) =>
            href ? (
              <OutboundLink key={i} href={href} ugc className={TEXT_LINK}>
                {text}
              </OutboundLink>
            ) : (
              <Fragment key={i}>{text}</Fragment>
            ),
          )}
        </p>
      )}
      <div className="flex flex-wrap items-center text-xs text-neutral-500">
        {segments.map((segment, i) => (
          <span key={i} className="flex items-center whitespace-nowrap">
            {i > 0 && (
              <span aria-hidden="true" className="px-1.5 text-neutral-700">
                ·
              </span>
            )}
            {segment}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The header action cluster: the icon row (linked accounts, then Edit profile when `canEdit`,
 * then `icons`), and `children` (Follow on someone else's profile). The marks sit right of the
 * title, where pages keep controls that act on their subject: ghost icon buttons throughout, Edit
 * profile included. `gap-1.5` matches the event page's action cluster; the cluster's `gap-2`
 * separates the row from the far-right button. It wraps and right-aligns, so on a phone marks and
 * button break onto separate lines. Edit mode renders `ProfileEditActions` in its place. */
export function ProfileActions({
  links,
  canEdit,
  edit,
  icons,
  children,
}: {
  links: ExternalLinks;
  canEdit: boolean;
  edit: ProfileEditState;
  icons?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <LinkedAccountsLine links={links} />
        {canEdit && (
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
        {icons}
      </div>
      {children}
    </div>
  );
}

/** The own profile's controls after Edit profile: **New collection**, then **Sign out**, which
 * arms on a first click and signs out on the second. Signing out re-renders the anonymous
 * profile, with no redirect. */
export function OwnProfileActions() {
  const { logout } = useAuth();
  const { armed, trigger, controlRef } = useConfirmAction(() => logout(), {
    timeoutMs: ARM_MS,
    dismissOnOutside: true,
  });
  return (
    <>
      <Tooltip label="New collection">
        <Link
          href={newCollectionHref()}
          className={buttonClasses("ghost", { icon: true })}
          aria-label="New collection"
        >
          <FolderPlus size={14} />
        </Link>
      </Tooltip>
      <Button
        ref={controlRef}
        icon
        variant="ghost"
        className={armed ? ARMED_RING : ""}
        onClick={trigger}
        // The name says which click this is (an icon button has no text to swap).
        aria-label={armed ? "Confirm sign out" : "Sign out"}
      >
        <LogOut size={14} />
      </Button>
    </>
  );
}

/** The edit mode's sticky actions: **Cancel** and **Save** on one line, then the save error. The
 * page passes them as `PageShell`'s `stickyActions`, so they stay pinned while the fields scroll. */
export function ProfileEditActions({ edit }: { edit: ProfileEditState }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={edit.cancelEditing} disabled={edit.saving}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={edit.saveEdits}
          disabled={edit.saving || edit.bioOver}
        >
          {edit.saving ? "Saving…" : "Save"}
        </Button>
      </div>
      {edit.saveError && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {edit.saveError}
        </div>
      )}
    </div>
  );
}

/** The edit-mode field that belongs to the header rather than a section card: the avatar picker.
 * Nothing in view mode. The picker is the shared `FileManager` in single-file image mode: its
 * remove control drops the picture, and its drop zone returns once none is staged. */
export function ProfileHeaderEditFields({
  name,
  edit,
}: {
  name: string;
  edit: ProfileEditState;
}) {
  if (!edit.editing) return null;

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
              username={name}
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
                username={name}
                size="w-20 h-20"
                fallback="icon"
                decorative
              />
            ),
          }
        : null;

  return (
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
  );
}
