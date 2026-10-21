import type { ReactNode } from "react";
import Image from "next/image";
import { NumberedSteps } from "@/components/ui/NumberedSteps";
import SHOTS from "./shots.json";

// The image and its legend both come from `shots.json`; the screenshot tooling, maintained separately,
// writes each page's shots to `public/<page>/`.

type Shots = typeof SHOTS;
type ShotRef = { [P in keyof Shots]: { page: P; id: keyof Shots[P] } }[keyof Shots];
type Size = { width: number; height: number };
type ShotSpec = {
  file: string;
  alt: string;
  viewport: Size;
  clip?: Size;
  markers: { label: string }[];
};

const FRAME = "rounded-lg border border-neutral-800 bg-neutral-900";

export function Shot({
  page,
  id,
  narrow = false,
  children,
}: ShotRef & { narrow?: boolean; children?: ReactNode }) {
  const shot = (SHOTS[page] as Record<string, ShotSpec>)[id];
  const { width, height } = shot.clip ?? shot.viewport;
  return (
    <figure
      className={
        narrow ? "grid items-start gap-4 sm:grid-cols-[12rem_1fr]" : "space-y-4"
      }
    >
      <Image
        src={`/${page}/${shot.file}`}
        alt={shot.alt}
        width={width}
        height={height}
        unoptimized
        className={`h-auto w-full ${FRAME} ${narrow ? "max-sm:max-w-48" : ""}`}
      />
      <figcaption className="space-y-3">
        <NumberedSteps steps={shot.markers.map(({ label }) => ({ title: label }))} />
        {children}
      </figcaption>
    </figure>
  );
}
