"use client";

import { useParams } from "next/navigation";
import Link from "next/link";

import { GeolocationEditForm } from "@/components/geolocations/edit/GeolocationEditForm";
import { PageCenter, PageShell } from "@/components/ui/PageShell";
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
    return (
      <PageCenter>
        <span className="text-neutral-500">Loading…</span>
      </PageCenter>
    );
  }

  if (error) {
    return (
      <PageCenter>
        <div className="text-center space-y-2">
          <p className="text-sm text-neutral-300">{error}</p>
          <Link href="/map" className="text-xs text-orange-400 hover:underline">
            Back to map
          </Link>
        </div>
      </PageCenter>
    );
  }

  if (!geo) {
    return (
      <PageCenter>
        <span className="text-neutral-500">Loading…</span>
      </PageCenter>
    );
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
            className="text-orange-400 hover:underline"
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
          This geolocation is submitted and frozen, it can no longer be edited.{" "}
          <Link
            href={`/geolocations/${geo.id}`}
            className="text-orange-400 hover:underline"
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
