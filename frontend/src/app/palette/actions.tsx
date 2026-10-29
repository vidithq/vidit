"use client";

import { useState } from "react";
import { ChevronDown, Copy, ExternalLink, History, UserPlus } from "lucide-react";

import { ActionMenu } from "@/components/ui/ActionMenu";
import {
  ACTION_ICONS,
  Button,
  DANGER_CONFIRM,
  type ButtonAction,
} from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CopyButton } from "@/components/ui/CopyButton";
import { ItemSearch } from "@/components/ui/ItemSearch";
import { Popover } from "@/components/ui/Popover";
import { RemoveButton } from "@/components/ui/RemoveButton";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { accountKey, analystAccount } from "@/lib/accounts";
import { accountItem } from "@/lib/items";
import { Variant, type PaletteCategory } from "./shared";

// One label per action icon, so a new action shows here before it ships.
const ACTION_LABELS: Record<ButtonAction, string> = {
  accept: "Accept",
  activity: "Show all activity",
  add: "Add a source",
  approve: "Approve",
  archive: "Wayback Machine",
  askApproval: "Ask for approval",
  cancel: "Cancel",
  collect: "Add to collection",
  continue: "Continue",
  copy: "Copy",
  delete: "Delete",
  dismiss: "Dismiss",
  draw: "Draw a contour on this source",
  fileSource: "File the source",
  filter: "Filters",
  follow: "Follow",
  following: "Following",
  geolocate: "Geolocate",
  go: "Go",
  graphic: "Mark graphic",
  guide: "Read Getting started",
  hide: "Hide",
  import: "Import archive",
  invite: "Invite",
  leave: "Leave",
  less: "Manage",
  link: "Link",
  map: "Explore the map",
  mint: "Mint code",
  more: "Show more",
  newCollection: "New collection",
  newSite: "Create the site",
  next: "Next",
  password: "Update password",
  previous: "Previous",
  remove: "Clear",
  report: "Send report",
  request: "Post request",
  retry: "Retry",
  revert: "Back to the current contour",
  review: "Start reviewing",
  role: "Make org manager",
  save: "Save version 2",
  search: "Your geolocations",
  seeAll: "See all",
  send: "Send reset link",
  show: "Restore",
  signIn: "Sign in",
  site: "Open the site page",
  skip: "Skip",
  undo: "Undo",
  unsubscribe: "Turn off",
  useProof: "Use a proof image",
};

function PaletteCopyButton({ variant }: { variant?: "secondary" }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <CopyButton
      label="Copy coordinates"
      announce="Coordinates copied"
      icon={<Copy size={14} />}
      variant={variant}
      copied={copied}
      onClick={() => void copy("48.500000, 37.800000")}
    />
  );
}

function PaletteConfirmDialog() {
  const [open, setOpen] = useState<"accent" | "danger" | null>(null);
  return (
    <>
      <Button action="approve" variant="secondary" onClick={() => setOpen("accent")}>
        Approve
      </Button>
      <Button action="delete" variant="danger" onClick={() => setOpen("danger")}>
        Delete organization
      </Button>
      {open === "accent" && (
        <ConfirmDialog
          title="Approve this version?"
          confirmLabel="Approve"
          confirmAction="approve"
          onConfirm={() => setOpen(null)}
          onCancel={() => setOpen(null)}
        >
          <p>You approve version 2 of this geolocation.</p>
          <p>An approval is final.</p>
        </ConfirmDialog>
      )}
      {open === "danger" && (
        <ConfirmDialog
          title="Delete osw?"
          confirmLabel="Delete organization"
          confirmAction="delete"
          tone="danger"
          onConfirm={() => setOpen(null)}
          onCancel={() => setOpen(null)}
        >
          <p>Deleting osw is irreversible. Type the slug to confirm.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

export const ACTIONS: PaletteCategory = {
  id: "actions",
  title: "Actions",
  tier: "high",
  entries: [
    {
      entry: "Button",
      demo: (
        <>
          <Variant label="variant">
            <div className="flex flex-wrap items-center gap-2">
              <Button action="geolocate" variant="primary">Publish</Button>
              <Button action="add" variant="secondary">Add a source</Button>
              <Button action="cancel" variant="ghost">Cancel</Button>
              <Button action="delete" variant="danger">Remove</Button>
              <Button action="report" variant="dangerGhost">Send report</Button>
            </div>
          </Variant>
          <Variant label="disabled">
            <div className="flex flex-wrap items-center gap-2">
              <Button action="geolocate" variant="primary" disabled>Publish</Button>
              <Button action="add" variant="secondary" disabled>Add a source</Button>
              <Button action="cancel" variant="ghost" disabled>Cancel</Button>
              <Button action="delete" variant="danger" disabled>Remove</Button>
            </div>
          </Variant>
          <Variant label="DANGER_CONFIRM">
            <Button action="delete" variant="danger" className={DANGER_CONFIRM}>
              Confirm
            </Button>
          </Variant>
          <Variant label="icon">
            <Button icon variant="ghost" aria-label="Copy coordinates" title="Copy coordinates">
              <Copy size={14} />
            </Button>
          </Variant>
          <Variant label="icon disabled">
            <Button
              icon
              variant="ghost"
              disabled
              aria-label="No map link until the coordinate pair is complete"
              title="No map link until the coordinate pair is complete"
            >
              <ExternalLink size={14} />
            </Button>
          </Variant>
        </>
      ),
    },
    {
      entry: "ACTION_ICONS",
      demo: (
        <div className="flex flex-wrap gap-2">
          {(Object.keys(ACTION_ICONS) as ButtonAction[]).map((action) => (
            <Button key={action} action={action} variant="secondary">
              {ACTION_LABELS[action]}
            </Button>
          ))}
        </div>
      ),
    },
    {
      entry: "RemoveButton",
      demo: (
        <>
          <RemoveButton label="Dismiss notification" />
          <Variant label="confirms">
            <RemoveButton confirms label="Close this geolocation" />
          </Variant>
        </>
      ),
    },
    {
      entry: "ConfirmButton",
      demo: (
        <>
          <ConfirmButton icon label="Remove bo" onConfirm={() => {}} />
          <ConfirmButton icon action="hide" label="Withhold the site" onConfirm={() => {}} />
          <ConfirmButton action="leave" label="Leave" onConfirm={() => {}} />
          <ConfirmButton label="Remove" name="Remove bo" onConfirm={() => {}} />
        </>
      ),
    },
    {
      entry: "CopyButton",
      demo: (
        <>
          <PaletteCopyButton />
          <Variant label="secondary">
            <PaletteCopyButton variant="secondary" />
          </Variant>
        </>
      ),
    },
    {
      entry: "ActionMenu",
      demo: (
        <>
          <ActionMenu
            label="Open the list"
            icon={<ChevronDown size={14} />}
            items={[
              { key: "one", label: "First link", href: "/palette", current: true },
              { key: "two", label: "Second link", href: "/palette" },
            ]}
          />
          <Variant label="matchTriggerWidth">
            <ActionMenu
              label="v2: choose a version"
              text="v2"
              icon={<ChevronDown size={14} />}
              menuLabel="Versions"
              matchTriggerWidth
              items={[
                { key: "v3", label: "v3", href: "/palette" },
                { key: "v2", label: "v2", href: "/palette", current: true },
                { key: "v1", label: "v1", href: "/palette" },
                {
                  key: "history",
                  label: "History",
                  icon: <History size={14} />,
                  href: "/palette",
                  iconOnly: true,
                },
              ]}
            />
          </Variant>
        </>
      ),
    },
    {
      entry: "Popover",
      demo: (
        <>
          <Popover label="Invite a geolocator" icon={<UserPlus size={14} />}>
            {(close) => (
              <ItemSearch
                aria-label="Invite a geolocator"
                options={[analystAccount({ username: "bo" }), analystAccount({ username: "cy" })]}
                toItem={accountItem}
                rowKey={accountKey}
                onPick={close}
                placeholder="Username"
                emptyText="No analyst matches."
                autoFocus
              />
            )}
          </Popover>
          <Variant label="compact">
            <span className="inline-flex items-center gap-2 text-sm text-neutral-400">
              by ana
              <Popover label="Invite a geolocator" icon={<UserPlus size={12} />} compact>
                {() => <p className="px-1 text-xs text-neutral-500">The picker goes here.</p>}
              </Popover>
            </span>
          </Variant>
        </>
      ),
    },
    {
      entry: "ConfirmDialog",
      demo: <PaletteConfirmDialog />,
    },
  ],
};
