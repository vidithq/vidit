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
import { posterFrameUrl } from "@/lib/mediaUrls";

/**
 * The player's skin. media-chrome renders each control in its own shadow root
 * and exposes the paint as custom properties, so the theme is variables on the
 * host (no specificity fight with Tailwind). Controls are flat so the bar
 * carries the plate. Tooltips are off: a tile is 160 px tall and the controller
 * clips its overflow.
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

// Our controls take media-chrome's box: a 24 px icon in 10 px of padding, 44 px
// square, flat. The floating plate of `FLOATING_CONTROL` flattens away here.
const BAR_BUTTON =
  "size-11 shrink-0 rounded-none bg-transparent text-neutral-100 backdrop-blur-none hover:bg-white/10 hover:text-white [&_svg]:size-6";

// Hands the 10 px back to media-chrome's own controls: Tailwind's preflight zeroes
// `padding`, and a document rule outranks a shadow-root `:host` rule. The sliders
// pad inside their shadow root and are unaffected.
const BAR_CONTROL = "px-2.5";

/**
 * The one video player, for every surface that plays a clip.
 *
 * Engine: media-chrome's `<media-controller>` around a plain `<video>`, with a
 * bar stripped to play, scrub, time, mute, volume, download and one big-view
 * control.
 *
 * **Auto-hide.** The bar fades while the clip plays untouched and returns on
 * pointer move, hover or focus. A paused clip always shows it.
 *
 * **Poster.** Stored clips have no poster derivative, so the source gets the
 * `#t=0.1` media fragment and the browser paints that frame.
 *
 * **Download.** `<a download>` is ignored cross-origin and media is served from
 * a separate origin (CloudFront in prod), so the bar carries
 * `MediaDownloadButton`, the blob-fetch control.
 *
 * **Sizing.** The frame is `object-contain`, so a portrait clip keeps its
 * shape. The volume slider drops out under 448 px of container width (`@max-md`,
 * the tile decides, not the viewport) because the controls overflow a ~380 px
 * gallery tile and the controller clips the rest.
 *
 * **Failure.** A clip the browser cannot decode swaps to a notice and keeps the
 * download. The verdict is keyed on the failing URL, so a new `src` starts
 * fresh.
 */
export function VideoPlayer({
  src,
  source,
  title,
  compact = false,
  className,
  onExpand,
}: {
  src: string;
  /** What the download control saves: a persisted row, or a plain URL. */
  source: DownloadSource;
  /** Accessible name for the player. */
  title?: string;
  /** Tighter type on the failure notice. */
  compact?: boolean;
  className?: string;
  /** Tile context: replaces the fullscreen button with an expand control that
   *  opens the shared lightbox. Omit in the lightbox. */
  onExpand?: () => void;
}) {
  // The failed URL, not a flag: comparing to `src` resets the verdict on a swap.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (failedSrc === src) {
    return (
      <div className={cn("relative block h-full w-full", className)}>
        <TileNotice compact={compact}>Video unavailable</TileNotice>
        {/* No bar, so the download moves to the corner. */}
        <div className="absolute right-2 top-2 z-10">
          <MediaDownloadButton source={source} />
        </div>
      </div>
    );
  }

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
        onError={() => setFailedSrc(src)}
        // media-chrome stamps tabindex="-1" on upgrade, which can beat hydration.
        suppressHydrationWarning
      />
      <MediaControlBar className="w-full bg-black/60 backdrop-blur-sm">
        <MediaPlayButton className={BAR_CONTROL} />
        <MediaTimeRange />
        <MediaTimeDisplay showDuration className={BAR_CONTROL} />
        <MediaMuteButton className={BAR_CONTROL} />
        <MediaVolumeRange className="@max-md:hidden" />
        <MediaDownloadButton source={source} className={BAR_BUTTON} />
        {/* One big-view control per context. */}
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

