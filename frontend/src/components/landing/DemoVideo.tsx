"use client";

import { useState } from "react";

// Landing about-video. Muted-autoplays on load with NO visible player chrome
// (clean storefront look); the native controls — play/pause, seek, unmute,
// fullscreen — reveal on hover/focus so a visitor can still drive it, then
// hide again on leave. Desktop-only target, so hover/focus is the right
// reveal trigger. A client island because page.tsx is a server component.
export default function DemoVideo({ src }: { src: string }) {
  const [showControls, setShowControls] = useState(false);
  return (
    <video
      src={src}
      autoPlay
      muted
      playsInline
      preload="metadata"
      controls={showControls}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
      onFocus={() => setShowControls(true)}
      onBlur={() => setShowControls(false)}
      className="h-full w-full"
    >
      Your browser doesn&rsquo;t support embedded video.
    </video>
  );
}
