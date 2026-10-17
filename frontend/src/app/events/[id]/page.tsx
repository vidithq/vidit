"use client";

import { useParams } from "next/navigation";

import type { EventDetail } from "@/types";
import { useApiResource } from "@/hooks/useApiResource";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { EventPageBody } from "@/components/event/EventPageBody";
import { useEventActions } from "@/components/event/useEventActions";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
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
      rail={approvalsCard}
      railLabel="Approvals"
      stickyHeader
    >
      {/* Directly under the header, where the menu that opened them is. Below `lg` the
          Approvals card stacks above them, under the title. */}
      {panels}
      <EventPageBody geo={geo} />
    </PageShell>
  );
}
