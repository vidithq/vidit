"use client";

import { useState, type CSSProperties } from "react";
import {
  MediaController,
  MediaControlBar,
  MediaPlayButton,
  MediaTimeRange,
  MediaTimeDisplay,
  MediaMuteButton,
  MediaVolumeRange,
  MediaFullscreenButton,
} from "media-chrome/react";

import { Expand } from "lucide-react";

import { Button } from "@/components/ui/Button";
import {
  MediaDownloadButton,
  type DownloadSource,
} from "@/components/ui/MediaDownloadButton";
import { TileNotice } from "@/components/ui/TileNotice";
import { cn } from "@/lib/cn";

/**
 * The player's whole skin. media-chrome renders each control in its own shadow
 * root and exposes the paint as custom properties, so the theme is a set of
 * variables on the host rather than selectors reaching inside: no specificity
 * fight with Tailwind, and one place to read the palette off.
 *
 * The values are the app's own: neutral-100 glyphs and text on a translucent
 * dark bar, the accent left out because playback chrome is not app navigation.
 * Controls are flat (`--media-control-background: transparent`) so the bar
 * itself carries the plate, and the hover wash matches `BAR_BUTTON` below.
 * Tooltips are off: a tile is 160 px tall and the controller clips its
 * overflow, so a tooltip would be sliced in half.
 */
const PLAYER_THEME = {
  "--media-primary-color": "#f5f5f5",
  "--media-background-color": "transparent",
  "--media-control-background": "transparent",
  "--media-control-hover-background": "rgb(255 255 255 / 0.1)",
  "--media-range-track-background": "rgb(255 255 255 / 0.25)",
  "--media-font-family": "inherit",
  "--media-font-weight": "500",
  "--media-font-size": "12px",
  "--media-tooltip-display": "none",
} as CSSProperties;

// Our own controls sit in the bar next to media-chrome's, so they take
// media-chrome's box: a control is a 24 px icon inside 10 px of padding, 44 px
// square (`--media-control-height` + `--media-control-padding`), square-cornered
// and flat, with the hover wash from the theme above. The floating plate of
// `FLOATING_CONTROL` (which `MediaDownloadButton` carries by default) flattens
// away here, since the bar already provides the backdrop.
const BAR_BUTTON =
  "size-11 shrink-0 rounded-none bg-transparent text-neutral-100 backdrop-blur-none hover:bg-white/10 hover:text-white [&_svg]:size-6";

// The same 10 px, handed back to the controls that come with media-chrome.
// Tailwind's preflight zeroes `padding` on every element in the document, and a
// document rule outranks a `:host` rule inside a shadow root whatever the
// specificity, so each control would otherwise draw its icon edge to edge and
// sit 24 px wide next to our 44 px ones. The sliders are unaffected: they pad
// inside their shadow root, where the reset cannot reach.
const BAR_CONTROL = "px-2.5";

/**
 * The one video player. Every surface that plays a clip (the detail gallery's
 * video tiles, the shared lightbox, and through it the media manager's staged
 * and persisted views) mounts this, so playback chrome can't drift into
 * per-surface copies of a native `<video controls>`.
 *
 * The engine is media-chrome: a `<media-controller>` wrapping a plain
 * `<video>`, with the browser's own controls left off and a `<media-control-bar>`
 * stripped to what an analyst uses on evidence clips: play, scrub, elapsed and
 * total time, mute, volume, download, and one big-view control. Casting, PiP,
 * playback speed and captions (stored clips carry no text tracks) are not
 * rendered at all. The controls are web components, so their behaviour is
 * independent of the React version, and their skin is the CSS variables above.
 *
 * **Auto-hide.** The bar fades out while the clip plays untouched and returns on
 * pointer move, hover or keyboard focus (`autohide`, in seconds). A paused clip
 * always shows it.
 *
 * **Poster.** A stored clip carries no poster derivative, so the source URL gets
 * the `#t=0.1` media fragment: the browser seeks a tenth of a second in while
 * loading metadata and paints that frame instead of a black rectangle.
 *
 * **Download.** A plain `<a download>` is ignored cross-origin, and media is
 * served from a separate origin (CloudFront in prod), so such an anchor
 * navigates to the file instead of saving it. The bar therefore carries
 * `MediaDownloadButton`, the same blob-fetch control every other media surface
 * uses, which saves a persisted row under its `original_filename`.
 *
 * **Sizing.** The controller fills its container and the frame is letterboxed
 * (`object-contain`), so a portrait clip keeps its shape instead of being
 * cropped by a landscape tile, and the bars show the tile's own backdrop. The
 * volume slider is the one control that drops out under 768 px of container
 * width (a container query, so it is the tile that decides, not the viewport):
 * the seven controls overflow a gallery tile, and the controller clips what
 * does not fit. The lightbox is wide enough to keep all of them.
 */
export function VideoPlayer({
  src,
  source,
  title,
  compact = false,
  className,
  onExpand,
}: {
  /** The playable URL. */
  src: string;
  /** What the download control saves: a persisted row, or a plain URL. */
  source: DownloadSource;
  /** Accessible name for the player. */
  title?: string;
  /** Tighter type on the failure notice, for the panel-width tiles. */
  compact?: boolean;
  /** Sizing from the call site; the player fills whatever box it is given. */
  className?: string;
  /** Big-view handler for a tile context: replaces the bar's fullscreen button
   *  with an expand control opening the shared lightbox, so a video tile and an
   *  image tile share one "see it bigger" gesture and only the lightbox's
   *  player offers the actual full screen. Omit for the lightbox context. */
  onExpand?: () => void;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) return <TileNotice compact={compact}>Video unavailable</TileNotice>;

  return (
    <MediaController
      className={cn("@container block h-full w-full", className)}
      style={PLAYER_THEME}
      autohide="2"
    >
      <video
        slot="media"
        src={posterFrameUrl(src)}
        aria-label={title}
        playsInline
        preload="metadata"
        className="h-full w-full object-contain"
        onError={() => setFailed(true)}
      />
      <MediaControlBar className="w-full bg-black/60 backdrop-blur-sm">
        <MediaPlayButton className={BAR_CONTROL} />
        <MediaTimeRange />
        <MediaTimeDisplay showDuration className={BAR_CONTROL} />
        <MediaMuteButton className={BAR_CONTROL} />
        <MediaVolumeRange className="@max-md:hidden" />
        <MediaDownloadButton source={source} className={BAR_BUTTON} />
        {/* One big-view icon per context: a tile expands into the shared
            lightbox, so the control sits where fullscreen normally lives; the
            lightbox itself keeps the real full screen. */}
        {onExpand ? (
          <Button
            icon
            variant="ghost"
            className={BAR_BUTTON}
            aria-label="Expand video"
            title="Expand video"
            onClick={onExpand}
          >
            <Expand size={16} />
          </Button>
        ) : (
          <MediaFullscreenButton className={BAR_CONTROL} />
        )}
      </MediaControlBar>
    </MediaController>
  );
}

/**
 * The source URL carrying the media fragment that makes an unplayed clip paint
 * its first frame. A URL that already names a fragment keeps it, so an explicit
 * start time from a caller wins.
 */
function posterFrameUrl(src: string): string {
  return src.includes("#") ? src : `${src}#t=0.1`;
}
