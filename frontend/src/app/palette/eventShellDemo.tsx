"use client";

import { useState } from "react";
import Link from "next/link";

import { EventShell } from "@/components/event/EventShell";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { TEXT_LINK } from "@/components/ui/styles";
import { cn } from "@/lib/cn";

// The `/palette` demo of `EventShell`: the real shell, its three zones (title section, actions block,
// body) filled with labelled empty boxes, in the three fillings the app renders. The boxes are demo
// scaffolding, not a primitive.

type EventShellFilling = "event" | "edit" | "submit";

const FILLINGS: { value: EventShellFilling; label: string }[] = [
  { value: "event", label: "Event page" },
  { value: "edit", label: "Edit" },
  { value: "submit", label: "Submit" },
];

export function isFilling(value: string | null): value is EventShellFilling {
  return FILLINGS.some((f) => f.value === value);
}

function Slot({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex items-center justify-center rounded-md border border-dashed border-neutral-600 bg-neutral-900/60 px-3 font-mono text-xs font-normal text-neutral-400",
        className,
      )}
    >
      {label}
    </span>
  );
}

/** The shell's three zones with the slots one filling uses, each an empty box named after its
 *  zone and slot. */
export function EventShellSkeleton({ filling }: { filling: EventShellFilling }) {
  const isEvent = filling === "event";
  return (
    <EventShell
      title={isEvent ? <Slot label="Title section: title" className="h-7" /> : "Form page name"}
      titleField={
        isEvent ? undefined : <Slot label="Title section: title field" className="h-[38px]" />
      }
      byline={<Slot label="Title section: byline" className="h-7" />}
      onBack={() => {}}
      actions={{
        pinned: <Slot label="Actions block: pinned row" className="h-9 w-56 max-w-full" />,
        below: <Slot label="Actions block: below the row" className="h-24" />,
      }}
      panels={isEvent ? <Slot label="Panels" className="h-16" /> : undefined}
      body={{
        sources: <Slot label="Body: sources" className="h-72" />,
        proof: { content: <Slot label="Body: proof" className="h-48" /> },
        location: { content: <Slot label="Body: location" className="h-64" /> },
        details: { content: <Slot label="Body: details" className="h-56" /> },
      }}
    />
  );
}

/**
 * The palette entry: the skeleton inline, so it takes the window's breakpoints (the two columns from
 * `lg` up, one column below), under a switch between the fillings. `/palette/event-shell` renders
 * the same skeleton as a page of its own.
 */
export function EventShellPreview() {
  const [filling, setFilling] = useState<EventShellFilling>("event");
  return (
    <div className="w-full space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          aria-label="Event shell filling"
          options={FILLINGS}
          value={filling}
          onChange={setFilling}
        />
        <Link href={`/palette/event-shell?filling=${filling}`} className={`text-xs ${TEXT_LINK}`}>
          Open as a page
        </Link>
      </div>
      <div className="rounded-md border border-neutral-800">
        <EventShellSkeleton filling={filling} />
      </div>
    </div>
  );
}
