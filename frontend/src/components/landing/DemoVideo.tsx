"use client";

import { useRef, useState } from "react";
import { Play } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { FLOATING_CONTROL } from "@/components/ui/styles";

// Landing about-video, click-to-play: nothing streams until asked (`preload="metadata"` paints the
// first frame as the poster). A tap on the frame or the play control starts it; native `controls`
// stay on afterwards so a phone can pause and scrub. `playsInline` keeps iOS in the frame. A client
// island because page.tsx is a server component.
export default function DemoVideo({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

  // A refused play() (interrupted gesture) leaves the overlay up instead of an unhandled rejection;
  // `onPlay` owns the state, so native controls and the keyboard flip it too.
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
        // Only before the first play: afterwards a click on the frame is the native controls' (it toggles pause).
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
