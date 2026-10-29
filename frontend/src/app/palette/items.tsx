"use client";

import { useState } from "react";
import { Archive, AtSign, BookOpen, ClipboardCheck, Mail, MapPin, MessageCircle, UserPlus } from "lucide-react";

import type { EventDetail } from "@/types";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { IconTile } from "@/components/ui/IconTile";
import { Item, type ItemVariant } from "@/components/ui/Item";
import { LinkRow } from "@/components/ui/LinkRow";
import { LoadMoreRow, SeeAllLink } from "@/components/ui/LoadMoreRow";
import { Pill } from "@/components/ui/Pill";
import { RemoveButton } from "@/components/ui/RemoveButton";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { detectionItem } from "@/components/detections/detectionItem";
import { SUBMIT_PATHS } from "@/components/geolocations/SubmitChooser";
import { NO_ANSWER } from "@/lib/errors";
import { collectionItem, eventItem, searchHitItem, siteItem } from "@/lib/items";
import { MOCK_DETAIL, MOCK_MEDIA, MOCK_SOURCE, Variant, type PaletteCategory } from "./shared";

const ITEM_VARIANTS: { value: ItemVariant; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "list", label: "List" },
  { value: "card", label: "Card" },
];

const OWNER = MOCK_DETAIL.owner;

// A detection with the whole evidence floor, and one short of several pieces.
const DETECTION_READY: EventDetail = {
  ...MOCK_DETAIL,
  id: "detection-ready",
  status: "detected",
  proof: '<img src="/local-storage/demo.jpg">',
  sources: [{ ...MOCK_SOURCE, kind: "unknown" }],
};

const DETECTION_SEVERAL_MISSING: EventDetail = {
  ...DETECTION_READY,
  id: "detection-several-missing",
  title: "Smoke over a treeline, location unclear",
  proof: null,
  sources: [],
};

// Every kind once with its picture and once without, then a search hit's highlight, a graphic
// file and the detections queue's badges.
const MOCK_ITEMS = [
  eventItem({ ...MOCK_DETAIL, media: MOCK_MEDIA }),
  eventItem({ ...MOCK_DETAIL, id: "demo-detected", status: "detected", title: "Convoy on a rural road, unnamed" }),
  eventItem({ ...MOCK_DETAIL, id: "demo-graphic", is_graphic: true, media: MOCK_MEDIA }),
  eventItem({ ...MOCK_DETAIL, id: "demo-request", status: "requested", title: "Where was this filmed?", media: MOCK_MEDIA }),
  eventItem({ ...MOCK_DETAIL, id: "demo-request-bare", status: "requested", title: "Smoke over a treeline" }),
  siteItem({
    id: "site-1",
    name: "Saky airbase",
    kind: "airbase",
    media: MOCK_MEDIA,
    last_source: { captured_at: "2026-06-01T09:30:00Z" },
    owner: OWNER,
  }),
  siteItem({ id: "site-2", name: "Northern fuel depot", kind: "depot", owner: OWNER }),
  collectionItem({
    id: "col-1",
    title: "Kupiansk rail corridor",
    cover: Array.from({ length: 4 }, () => ({
      url: MOCK_MEDIA.storage_url,
      kind: "image" as const,
      role: "source" as const,
    })),
    event_count: 12,
    first_date: "2026-03-01",
    last_date: "2026-05-09",
    owner: OWNER,
  }),
  collectionItem({ id: "col-2", title: "Dam breach", cover: [], event_count: 0, owner: OWNER }),
  searchHitItem({
    type: "event",
    id: "hit-1",
    title: "Strike on a depot, Donetsk",
    title_highlight: "\u0002Strike\u0003 on a depot, Donetsk",
    status: "geolocated",
    occurred_date: "2026-05-09",
    created_at: "2026-05-10T08:00:00Z",
    lat: 48.0159,
    lng: 37.8024,
    is_graphic: false,
    owner: OWNER,
    geolocators: [],
    tags: [],
    media: [MOCK_MEDIA],
  }),
  searchHitItem({
    type: "user",
    id: "u1",
    username: "analyst",
    username_highlight: "\u0002analyst\u0003",
    bio: "Geolocates footage from the southern front.",
    bio_highlight: null,
    avatar_url: null,
  }),
  searchHitItem({
    type: "organization",
    id: "o1",
    slug: "open-desk",
    name: "Open desk",
    name_highlight: "Open desk",
    bio: null,
    bio_highlight: null,
    avatar_url: null,
    member_count: 4,
  }),
  detectionItem(DETECTION_READY),
  detectionItem(DETECTION_SEVERAL_MISSING),
];

function PaletteItems() {
  const [variant, setVariant] = useState<ItemVariant>("list");
  return (
    <div className="w-full space-y-3">
      <SegmentedControl<ItemVariant>
        aria-label="Item variant"
        options={ITEM_VARIANTS}
        value={variant}
        onChange={setVariant}
      />
      <div className={variant === "card" ? "grid gap-3 sm:grid-cols-2" : "max-w-xl space-y-2"}>
        {MOCK_ITEMS.map((item, index) => (
          <Item key={index} variant={variant} {...item} href={undefined} />
        ))}
        <Item
          variant={variant}
          {...MOCK_ITEMS[0]}
          onSelect={() => {}}
          selectLabel="Read this collection from here"
          selected
        />
      </div>
    </div>
  );
}

const MAYA = <Avatar username="maya" size="size-7" decorative />;

export const ITEMS: PaletteCategory = {
  id: "items",
  title: "Items and lists",
  entries: [
    { entry: "Item", demo: <PaletteItems /> },
    {
      entry: "LinkRow",
      demo: (
        <>
          <div className="w-full max-w-md space-y-2">
            <LinkRow icon={AtSign} label="X / Twitter" value="@vidithq" href="https://x.com/vidithq" />
            <LinkRow icon={BookOpen} label="Getting started" value="/guide" href="/guide" external={false} />
            <LinkRow icon={Mail} label="Email" value="hello@vidit.app" href="mailto:hello@vidit.app" external={false} />
            <LinkRow icon={MessageCircle} label="Discord" value="a-handle (unresolved)" />
            <LinkRow
              icon={UserPlus}
              leading={MAYA}
              label="New follower · Oct 12"
              value="maya followed you"
              href="/palette"
              external={false}
            />
          </div>
          <Variant label="arrow" className="w-full max-w-md space-y-2">
            <LinkRow
              variant="arrow"
              icon={ClipboardCheck}
              leading={MAYA}
              label="Approval request · Oct 12"
              value="maya asked you to approve: Strike on the fuel depot north of the river crossing"
              href="/palette"
              external={false}
              action={<RemoveButton label="Dismiss notification" />}
            />
            <LinkRow
              variant="arrow"
              icon={MapPin}
              value={
                <>
                  Strike on the{" "}
                  <mark className="rounded-sm bg-orange-500/30 px-0.5 text-inherit">depot</mark>
                </>
              }
              meta="Geolocated · 9 May 2026 · maya"
              href="/palette"
              external={false}
            />
            <LinkRow
              variant="arrow"
              icon={UserPlus}
              leading={MAYA}
              value="maya"
              meta={
                <>
                  <Pill tone="accent">Org manager</Pill>
                  <span>Joined Oct 12</span>
                </>
              }
              href="/palette"
              external={false}
              action={
                <>
                  <Button action="role" variant="ghost">
                    Make member
                  </Button>
                  <Button action="delete" variant="danger">
                    Remove
                  </Button>
                </>
              }
            />
          </Variant>
        </>
      ),
    },
    {
      entry: "IconTile",
      demo: (
        <div className="w-full max-w-3xl space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <IconTile
              icon={<Archive size={13} strokeWidth={1.8} />}
              title="Upload your X archive"
              note="Your whole history, once."
              href="/import#archive"
            />
            <IconTile
              icon={<ClipboardCheck size={13} strokeWidth={1.8} />}
              title="Request approval"
              note="Ask an analyst or an organization to approve yours."
            />
          </div>
          <Variant label="preview and needs">
            <div className="grid gap-2 sm:auto-rows-fr sm:grid-cols-2 sm:gap-5">
              {SUBMIT_PATHS.slice(0, 2).map((path) => (
                <IconTile key={path.title} {...path} />
              ))}
            </div>
          </Variant>
        </div>
      ),
    },
    {
      entry: "LoadMoreRow / SeeAllLink",
      demo: (
        <>
          <Variant label="idle" className="w-full max-w-xs">
            <LoadMoreRow walk={{ hasMore: true, loadingMore: false, loadMore: () => {}, error: null }} />
          </Variant>
          <Variant label="loading" className="w-full max-w-xs">
            <LoadMoreRow walk={{ hasMore: true, loadingMore: true, loadMore: () => {}, error: null }} />
          </Variant>
          <Variant label="failed page" className="w-full max-w-xs">
            <LoadMoreRow walk={{ hasMore: true, loadingMore: false, loadMore: () => {}, error: NO_ANSWER }} />
          </Variant>
          <Variant label="SeeAllLink">
            <SeeAllLink href="/search?type=event&author=ana" />
          </Variant>
        </>
      ),
    },
  ],
};
