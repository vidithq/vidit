import React from "react";
import { OffthreadVideo, staticFile } from "remotion";
import { BrowserChrome } from "./BrowserChrome";

// Plays a captured Chrome recording inside the same faked browser
// chrome the still scenes use, so the cut from a still to the
// recording reads as continuous "we're watching a browser" instead of
// a styled-vs-bare mismatch.
//
// playbackRate < 1 lets us slow the recording down without re-encoding
// — useful when a 14s capture needs to fill an 18s slot at a more
// readable pace.
export const VideoChrome: React.FC<{
  src: string;
  url: string;
  width: number;
  height: number;
  playbackRate?: number;
  startFrom?: number; // source frames to skip from the start
}> = ({ src, url, width, height, playbackRate = 1, startFrom = 0 }) => {
  return (
    <BrowserChrome url={url} width={width} height={height}>
      <OffthreadVideo
        src={staticFile(src)}
        playbackRate={playbackRate}
        // `startFrom` on <OffthreadVideo> is measured in SOURCE-video
        // frames (at the source's frame rate), not comp frames — so for
        // a 30 fps recording you skip 60 frames per second of source.
        // Currently 0 in the only caller, so this just documents the
        // contract for whoever bumps the skip next.
        startFrom={startFrom}
        muted
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
    </BrowserChrome>
  );
};
