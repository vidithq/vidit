"use client";

import { useRef, useState } from "react";
import { Play } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { FLOATING_CONTROL } from "@/components/ui/styles";

// Landing about-video. Click-to-play: nothing streams until a visitor asks for
// it (`preload="metadata"` fetches the header and paints the first frame, which
// serves as the poster, so the clip itself costs an anonymous visitor nothing).
// A tap anywhere on the frame, or on the centered play control, starts it, and
// native `controls` stay on from then on, so a phone can pause and scrub with
// no hover to reveal them. `playsInline` keeps iOS playing in the frame instead
// of taking over the screen. A client island because page.tsx is a server
// component.
export default function DemoVideo({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

  // A refused play() (an interrupted gesture) leaves the overlay up rather than
  // raising an unhandled rejection; `onPlay` owns the state, so playback
  // started from the native controls or the keyboard flips it too.
  function start() {
    void videoRef.current?.play().catch(() => {});
  }

  return (
    <div className="relative h-full w-full">
      <video
        ref={videoRef}
        src={src}
        playsInline
        preload="metadata"
        controls={started}
        // Only before the first play: once the native controls are up, a click
        // on the frame is theirs (it toggles pause), and re-playing here would
        // undo it.
        onClick={started ? undefined : start}
        onPlay={() => setStarted(true)}
        className="h-full w-full"
      >
        Your browser doesn&rsquo;t support embedded video.
      </video>
      {!started && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Button
            icon
            variant="ghost"
            className={`${FLOATING_CONTROL} pointer-events-auto`}
            onClick={start}
            aria-label="Play the demo video"
          >
            <Play size={18} />
          </Button>
        </div>
      )}
    </div>
  );
}
