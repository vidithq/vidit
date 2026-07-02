"use client";

import { useParams } from "next/navigation";
import Link from "next/link";

import { GeolocationEditForm } from "@/components/geolocations/edit/GeolocationEditForm";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { TEXT_LINK } from "@/components/ui/styles";
import { useApiResource } from "@/hooks/useApiResource";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import type { GeolocationDetail } from "@/types";

export default function EditGeolocationPage() {
  const params = useParams();
  const { user, loading: authLoading } = useRequireAuth();
  const id = typeof params.id === "string" ? params.id : "";

  const { data: geo, error } = useApiResource<GeolocationDetail>(
    user && id ? `/geolocations/${id}` : null
  );

  if (authLoading || !user) {
    return <PageLoading />;
  }

  if (error) {
    return <PageError message={error} backHref="/map" />;
  }

  if (!geo) {
    return <PageLoading />;
  }

  // The submit flow is owner-only and state-gated to ``detected``, the same
  // gate the backend enforces (403 / 409). Surface it before the form rather
  // than letting a PATCH bounce.
  if (user.id !== geo.author.id) {
    return (
      <PageShell back title="Edit detection">
        <p className="text-sm text-neutral-400">
          You can only edit your own detections.{" "}
          <Link
            href={`/geolocations/${geo.id}`}
            className={TEXT_LINK}
          >
            View this geolocation
          </Link>
          .
        </p>
      </PageShell>
    );
  }

  if (geo.status !== "detected") {
    return (
      <PageShell back title="Edit detection">
        <p className="text-sm text-neutral-400">
          This geolocation is geolocated and frozen, it can no longer be edited.{" "}
          <Link
            href={`/geolocations/${geo.id}`}
            className={TEXT_LINK}
          >
            View it
          </Link>
          .
        </p>
      </PageShell>
    );
  }

  return (
    <GeolocationEditForm
      geo={geo}
      redirectTo={`/profile/${user.username}/detections`}
    />
  );
}
