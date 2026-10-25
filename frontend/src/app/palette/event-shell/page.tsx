"use client";

import { Suspense } from "react";
import { notFound, useSearchParams } from "next/navigation";

import { EventShellSkeleton, isFilling } from "../eventShellDemo";

/** `EventShell` with every slot empty, for the `/palette` previews. `?filling=event|edit|submit`. */
export default function EventShellDemoPage() {
  // Dev reference only, like `/palette`.
  if (process.env.NODE_ENV !== "development") notFound();
  // `useSearchParams` opts out of static prerender, so Next requires a Suspense boundary.
  return (
    <Suspense>
      <Filled />
    </Suspense>
  );
}

function Filled() {
  const filling = useSearchParams().get("filling");
  return <EventShellSkeleton filling={isFilling(filling) ? filling : "event"} />;
}
