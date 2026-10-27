import type { ReactNode } from "react";
import { Archive, ArrowRight, MapPin, MapPinPlus, Megaphone, Play } from "lucide-react";

import { StatusBadge } from "@/components/event/StatusBadge";
import { XGlyph } from "@/components/ui/BrandGlyphs";
import { IconTile } from "@/components/ui/IconTile";
import { Pill } from "@/components/ui/Pill";
import { cn } from "@/lib/cn";
import { CollectionIcon, newCollectionHref } from "@/lib/collections";
import { IMPORT_GLYPH } from "@/lib/importEntries";
import { submitHref } from "@/lib/routes";
import { NEW_SITE_HREF } from "@/lib/sites";

// Drawings of each path's result, built from the product's own badges. Illustration only, like
// `MockPost`: the same for every analyst, so they read the same in both themes and on a new account.

const BAR = "h-1.5 rounded-full bg-neutral-700";

function Bars({ widths }: { widths: string[] }) {
  return (
    <div className="space-y-1.5">
      {widths.map((width, i) => (
        <div key={i} className={cn(BAR, width)} />
      ))}
    </div>
  );
}

function MapPlate({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative h-full w-full overflow-hidden bg-neutral-950"
      style={{
        backgroundImage:
          "linear-gradient(var(--color-neutral-800) 1px, transparent 1px), linear-gradient(90deg, var(--color-neutral-800) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
      }}
    >
      {children}
    </div>
  );
}

function MiniCard({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-md border border-neutral-700 bg-neutral-900 p-2 shadow-lg shadow-black/30",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Plate({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex h-full items-center justify-center gap-2 bg-neutral-950 px-3", className)}>
      {children}
    </div>
  );
}

const Into = () => <ArrowRight size={14} className="shrink-0 text-neutral-600" />;

const GEOLOCATION_PREVIEW = (
  <MapPlate>
    <span className="absolute left-[68%] top-[34%] flex size-3 items-center justify-center">
      <span className="absolute size-6 rounded-full bg-orange-500/20" />
      <span className="size-3 rounded-full bg-orange-500 ring-2 ring-neutral-950" />
    </span>
    <MiniCard className="absolute bottom-3 left-3 w-[58%] space-y-2">
      <StatusBadge status="geolocated" />
      <Bars widths={["w-full", "w-2/3"]} />
    </MiniCard>
  </MapPlate>
);

const REQUEST_PREVIEW = (
  <Plate className="gap-3 px-4">
    <div className="flex aspect-video w-[46%] items-center justify-center rounded-md border border-neutral-700 bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-900">
      <span className="flex size-6 items-center justify-center rounded-full border border-neutral-600 bg-neutral-900 text-neutral-400">
        <Play size={10} />
      </span>
    </div>
    <div className="space-y-2">
      <StatusBadge status="requested" />
      <span className="flex size-7 items-center justify-center rounded-full border border-dashed border-orange-500/60 text-xs font-medium text-orange-400">
        ?
      </span>
    </div>
  </Plate>
);

const XPOST_PREVIEW = (
  <Plate>
    <div className="w-[48%] rounded-lg border border-neutral-800 bg-black p-2">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="size-4 rounded-full bg-gradient-to-br from-orange-500 to-red-600" />
        <span className="text-neutral-400">
          <XGlyph size={9} />
        </span>
      </div>
      <Bars widths={["w-full"]} />
      <p className="mt-1.5 font-mono text-[9px] text-sky-500">47.51, 34.59</p>
    </div>
    <Into />
    <StatusBadge status="detected" />
  </Plate>
);

const BULK_PREVIEW = (
  <Plate>
    <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-900 text-neutral-400">
      <Archive size={18} strokeWidth={1.6} />
    </span>
    <Into />
    <div className="w-[52%] space-y-1">
      {[0, 1, 2].map((i) => (
        <MiniCard key={i} className={cn("flex items-center gap-2 px-1.5 py-1", i === 2 && "opacity-50")}>
          <span className="h-4 w-6 shrink-0 rounded-sm bg-neutral-800" />
          <div className={cn(BAR, "flex-1")} />
          <StatusBadge status="detected" />
        </MiniCard>
      ))}
    </div>
  </Plate>
);

const SITE_PREVIEW = (
  <MapPlate>
    <svg viewBox="0 0 200 100" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet">
      <polygon
        points="62,22 128,16 150,58 104,84 54,66"
        className="fill-orange-500/15 stroke-orange-500"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
    <div className="absolute bottom-2.5 left-3 right-3 flex justify-between">
      {["Mar", "May", "Aug"].map((month) => (
        <Pill key={month} tone="neutral">
          {month}
        </Pill>
      ))}
    </div>
  </MapPlate>
);

const COLLECTION_PREVIEW = (
  <Plate>
    <div className="relative aspect-[4/3] h-[70%]">
      <MiniCard className="absolute inset-0 translate-x-3 -translate-y-2 rotate-3 opacity-40" />
      <MiniCard className="absolute inset-0 translate-x-1.5 -translate-y-1 rotate-1 opacity-70" />
      <MiniCard className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-[2px] p-1">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="rounded-sm bg-neutral-800" />
        ))}
      </MiniCard>
    </div>
  </Plate>
);

const GLYPH = { size: 13, strokeWidth: 1.8 } as const;

// Geolocation and Request open the same form: the publish actions unlock from what you fill in.
export const SUBMIT_PATHS = [
  {
    href: submitHref("single"),
    icon: <MapPin {...GLYPH} />,
    title: "Geolocation",
    note: "You found where it happened.",
    needs: ["Source", "Coordinates", "Proof image", "Conflict"],
    preview: GEOLOCATION_PREVIEW,
  },
  {
    href: submitHref("single"),
    icon: <Megaphone {...GLYPH} />,
    title: "Request",
    note: "You have the footage, not the place.",
    needs: ["Source"],
    preview: REQUEST_PREVIEW,
  },
  {
    href: submitHref("xpost"),
    icon: IMPORT_GLYPH.paste,
    title: "From an X post",
    note: "You already posted it on X.",
    needs: ["Post link", "Linked X account"],
    preview: XPOST_PREVIEW,
  },
  {
    href: submitHref("bulk"),
    icon: IMPORT_GLYPH.archive,
    title: "Bulk import",
    note: "Your past posts, all at once.",
    needs: ["X archive", "Linked X account"],
    preview: BULK_PREVIEW,
  },
  {
    href: NEW_SITE_HREF,
    icon: <MapPinPlus {...GLYPH} />,
    title: "Site",
    note: "You watch a place change over time.",
    needs: ["Name", "Dated capture", "Outline"],
    preview: SITE_PREVIEW,
  },
  {
    href: newCollectionHref(),
    icon: <CollectionIcon {...GLYPH} />,
    title: "Collection",
    note: "You want to share a set of events.",
    needs: ["Title", "Description"],
    preview: COLLECTION_PREVIEW,
  },
];

/** The `/submit` chooser: one previewed `IconTile` per path, a 3x2 grid of equal tiles from `lg` up. */
export function SubmitChooser() {
  return (
    <div
      role="group"
      aria-label="Submission mode"
      className="grid gap-2 sm:auto-rows-fr sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 lg:gap-6"
    >
      {SUBMIT_PATHS.map((path) => (
        <IconTile key={path.title} {...path} />
      ))}
    </div>
  );
}
