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

/** Three lines of title in the card's left column. */
const TITLE_MAX = 64;

/** Handle width the byline can hold under the readings. */
const HANDLE_MAX = 24;

/** The mosaic panel: 16:9, the aspect the profile card's slot holds it at, at
 *  the width the event card gives its locator. `gap` is `<CollectionCover>`'s,
 *  so the tiles read as one picture divided rather than as four cards. */
const PANEL = { width: 480, height: 270, gap: 2 };

/** What one tile of the mosaic draws. A clip has no still the server can read,
 *  and a picture whose fetch was refused has none either, so both fall back to
 *  the panel colour and only the clip says why. */
type MosaicTile =
  | { kind: "image"; src: string }
  | { kind: "video" }
  | { kind: "blank" };

/**
 * Read one cover tile as something the card can draw.
 *
 * A picture is inlined through the guarded fetch (`ogImageDataUri`), at the
 * derivative the tile's own size wants: the wide `_hero` for a tile that fills
 * the panel, the 400px `_thumb` for one sharing it, which is the pick
 * `<CollectionCover>` makes for the same two cases. A clip carries no
 * derivative and no poster, so nothing is fetched for it.
 */
async function readTile(tile: CollectionCoverTile, lone: boolean): Promise<MosaicTile> {
  if (tile.media_type !== "image") return { kind: "video" };
  const urls = displayUrlsFor({ storage_url: tile.url, media_type: tile.media_type });
  const src = await ogImageDataUri(lone ? urls.hero : urls.thumbnail);
  return src ? { kind: "image", src } : { kind: "blank" };
}

/** The triangle a clip's tile wears in place of a frame. Drawn as a path rather
 *  than borrowed from the app's icon set, which Satori cannot render. */
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
    // Satori draws `<img>`, not `next/image`: this tree is rasterised on the
    // server and never reaches a browser that could run the optimizer.
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

/**
 * The mosaic, in `<CollectionCover>`'s arrangement: `ogMosaicBoxes` states
 * where each tile sits and this draws them, so the unfurl and the profile card
 * divide the same slot the same way.
 *
 * A collection with nothing showable draws the panel under the site's own
 * placeholder wording rather than an empty box.
 */
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
        // What shows between the tiles, and what a collection with no mosaic
        // shows instead of them.
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
  // A read that failed rather than answered says nothing about the link, so the
  // card says nothing about it either.
  if (read.status === "failed") {
    return ogFailedReadResponse();
  }

  const collection = read.data;
  // As many tiles as the panel divides into, and no more: the arrangement is
  // what decides how many boxes there are, so a wider cover cannot spill out.
  const cover = collection.cover.slice(0, ogMosaicBoxes(collection.cover.length, PANEL).length);
  // Every tile at once, each under the fetch's own budget, so a card costs one
  // round of requests rather than a chain of them.
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
          {/* How much it holds and the span its items cover, in the phrasing
              the page and the profile card both print. */}
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
