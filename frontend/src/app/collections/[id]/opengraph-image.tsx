import {
  collectionMetaSegments,
  type Collection,
  type CollectionCoverTile,
} from "@/lib/collections";
import { displayUrlsFor } from "@/lib/mediaUrls";
import { ogMosaicBoxes, ogTruncate, type OgMosaicBox } from "@/lib/og";

import {
  OG_COLOR,
  OG_CONTENT_TYPE,
  OG_SIZE,
  OgBadge,
  OgCard,
  ogFailedReadResponse,
  ogImageResponse,
} from "../../_og/card";
import { ogFetch, ogImageDataUri } from "../../_og/data";

// `og:image` for `/collections/{id}`: the collection's mosaic as a share card.
// One read of `GET /collections/{id}`, the same anonymous payload the page
// renders from, so the card can only ever show what a signed-out visitor
// already sees; the tiles come off that payload's `cover`, which the server
// already computed over the events the collection may show and with graphic
// items skipped, so no filtering happens here.

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "A collection on Vidit: title, what it holds, and the mosaic of its items.";

const TITLE_MAX = 64;

const HANDLE_MAX = 24;

/** Mosaic panel: 16:9; `gap` matches `<CollectionCover>`. */
const PANEL = { width: 480, height: 270, gap: 2 };

/** One mosaic tile. A clip, or a picture whose fetch was refused, falls back to the panel colour. */
type MosaicTile =
  | { kind: "image"; src: string }
  | { kind: "video" }
  | { kind: "blank" };

/**
 * Reads one cover tile for the card: pictures are inlined through the guarded
 * fetch at the `_hero` or `_thumb` derivative `<CollectionCover>` picks (a proof
 * tile uses its original, by `role`); a clip fetches nothing.
 */
async function readTile(tile: CollectionCoverTile, lone: boolean): Promise<MosaicTile> {
  if (tile.media_type !== "image") return { kind: "video" };
  const urls = displayUrlsFor({
    storage_url: tile.url,
    media_type: tile.media_type,
    role: tile.role,
  });
  const src = await ogImageDataUri(lone ? urls.hero : urls.thumbnail);
  return src ? { kind: "image", src } : { kind: "blank" };
}

/** Play triangle as a path; Satori cannot render the app's icon set. */
function PlayGlyph({ size: glyph }: { size: number }) {
  return (
    <svg width={glyph} height={glyph} viewBox="0 0 24 24">
      <path d="M9 7.5 L18 12 L9 16.5 Z" fill={OG_COLOR.muted} />
    </svg>
  );
}

function MosaicTileBox({ tile, box }: { tile: MosaicTile; box: OgMosaicBox }) {
  const frame = {
    position: "absolute" as const,
    display: "flex" as const,
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  };
  if (tile.kind === "image") {
    // Satori draws `<img>`, not `next/image`: this tree is rasterised on the server.
    return (
      <img
        src={tile.src}
        alt=""
        width={box.width}
        height={box.height}
        style={{ ...frame, objectFit: "cover" }}
      />
    );
  }
  return (
    <div style={{ ...frame, alignItems: "center", justifyContent: "center", background: OG_COLOR.panel }}>
      {tile.kind === "video" ? <PlayGlyph size={Math.min(box.width, box.height) / 3} /> : null}
    </div>
  );
}

/** The mosaic in `<CollectionCover>`'s arrangement (`ogMosaicBoxes`); empty collections draw the placeholder wording. */
function MosaicPanel({ tiles }: { tiles: MosaicTile[] }) {
  const boxes = ogMosaicBoxes(tiles.length, PANEL);
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        width: `${PANEL.width}px`,
        height: `${PANEL.height}px`,
        borderRadius: "16px",
        border: `2px solid ${OG_COLOR.border}`,
        background: OG_COLOR.panel,
        overflow: "hidden",
      }}
    >
      {boxes.length === 0 ? (
        <div style={{ display: "flex", fontSize: "28px", color: OG_COLOR.faint }}>no media</div>
      ) : null}
      {boxes.map((box, index) => (
        <MosaicTileBox key={`${box.left}-${box.top}`} tile={tiles[index]} box={box} />
      ))}
    </div>
  );
}

function NotFoundCard() {
  return (
    <OgCard>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ display: "flex", fontSize: "72px", color: OG_COLOR.text }}>
          No collection here
        </div>
        <div style={{ display: "flex", marginTop: "20px", fontSize: "30px", color: OG_COLOR.muted }}>
          This link points at nothing in the catalog.
        </div>
      </div>
    </OgCard>
  );
}

export default async function CollectionOpenGraphImage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const read = await ogFetch<Collection>(`/collections/${encodeURIComponent(id)}`);

  if (read.status === "missing") {
    return ogImageResponse(<NotFoundCard />);
  }
  // A failed read says nothing about the link, so neither does the card.
  if (read.status === "failed") {
    return ogFailedReadResponse();
  }

  const collection = read.data;
  // As many tiles as the arrangement has boxes, so a wider cover cannot spill out.
  const cover = collection.cover.slice(0, ogMosaicBoxes(collection.cover.length, PANEL).length);
  // Fetch all tiles at once, each under its own budget.
  const tiles = await Promise.all(cover.map((tile) => readTile(tile, cover.length === 1)));

  return ogImageResponse(
    <OgCard badge={<OgBadge label="Collection" tone="accent" />}>
      <div style={{ display: "flex", width: "100%", alignItems: "center" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minWidth: 0,
            paddingRight: "48px",
          }}
        >
          <div style={{ display: "flex", fontSize: "44px", lineHeight: 1.15, color: OG_COLOR.text }}>
            {ogTruncate(collection.title, TITLE_MAX)}
          </div>
          <div style={{ display: "flex", marginTop: "24px", fontSize: "26px", color: OG_COLOR.accent }}>
            {collectionMetaSegments(collection).join("  ·  ")}
          </div>
          <div style={{ display: "flex", marginTop: "14px", fontSize: "24px", color: OG_COLOR.muted }}>
            @{ogTruncate(collection.owner.username, HANDLE_MAX)}
          </div>
        </div>

        <MosaicPanel tiles={tiles} />
      </div>
    </OgCard>,
  );
}
