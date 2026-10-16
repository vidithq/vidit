"use client";

import { useParams } from "next/navigation";

import type { EventDetail } from "@/types";
import { useApiResource } from "@/hooks/useApiResource";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { EventPageBody } from "@/components/event/EventPageBody";
import { useEventActions } from "@/components/event/useEventActions";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { cn } from "@/lib/cn";
import { creditProps } from "@/lib/geolocatorCredit";

export default function EventPage() {
  const params = useParams();
  const eventId = typeof params.id === "string" ? params.id : "";
  const {
    data: geo,
    error,
    refetch,
  } = useApiResource<EventDetail>(eventId ? `/events/${eventId}` : null);
  // Called before the early returns.
  const { actions, panels, approvalsCard } = useEventActions({
    event: geo,
    surface: "event",
    onChanged: refetch,
  });

  if (error)
    return (
      <PageError message={error} />
    );
  if (!geo) return <PageLoading />;

  return (
    <PageShell
      back
      title={geo.title}
      subtitle={<AuthorByline {...creditProps(geo)} avatar />}
      actions={actions}
    >
        {/* Directly under the header, where the menu that opened them is. */}
        {panels}

        {/* Two columns from `lg`: the record, and the Approvals card beside it. Below `lg` the
            card comes first, under the title. The card sticks while the record scrolls, and scrolls
            on its own once it is taller than the viewport, so its foot stays reachable. */}
        <div
          className={cn(
            "grid gap-6",
            approvalsCard && "lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start",
          )}
        >
          {approvalsCard && (
            <aside className="min-w-0 lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto">
              {approvalsCard}
            </aside>
          )}
          <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
            <EventPageBody geo={geo} />
          </div>
        </div>
    </PageShell>
  );
}
