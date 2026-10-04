"use client";

import { useRouter } from "next/navigation";

import {
  EventFormFields,
  useEventForm,
} from "@/components/geolocations/EventFormFields";
import { PageShell } from "@/components/ui/PageShell";
import { isSnapshotUrl, SNAPSHOT_HINT } from "@/components/ui/ArchivedCopies";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { IncompleteFormNotice } from "@/components/ui/IncompleteFormNotice";
import { Button } from "@/components/ui/Button";
import { useEventActions } from "@/components/event/useEventActions";
import { useMutation } from "@/hooks/useMutation";
import {
  missingEventRequestFields,
  parseCaptureCoords,
  parseGuessCoords,
  updateEventRequest,
} from "@/lib/events";
import type { EventDetail } from "@/types";

/**
 * Owner edit of an open request, the third shape of the one edit address.
 *
 * A request is a question, not a vouched claim, so this write overwrites the row:
 * no version is filed, and the id, requester and bot provenance stay put. The
 * fields are the submit form's request fields, in the shared `EventFormFields`.
 *
 * The floor is the request floor: a title, the source, and the footage. Placing
 * a coordinate publishes nothing (the geolocate does, through
 * `/submit?request_id=`). The source instant is not in the floor, since the bot
 * opens requests whose source date it could not read.
 */
export function RequestEditForm({
  geo,
  redirectTo,
}: {
  geo: EventDetail;
  redirectTo: string;
}) {
  const router = useRouter();
  // No action tier here, as on the published edit form (the grammar in
  // `useEventActions` decides); the call stays for the panels slot.
  const { actions, panels } = useEventActions({ event: geo, surface: "edit" });

  // A `requested` row always has a source URL (`ck_events_source_url_status`);
  // the block's `?? ""` seed only satisfies the nullable wire type.
  const form = useEventForm(geo);

  const keptMediaCount =
    geo.media.filter((m) => !form.removedIds.has(m.id)).length +
    form.newFiles.length;

  const saveMutation = useMutation(
    () =>
      updateEventRequest(geo.id, {
        ...form.shared(),
        title: form.title.trim(),
        source_url: form.sourceUrl.trim(),
        // Both-or-neither parse, so a half-typed pair is dropped, not a 400.
        ...parseGuessCoords(form.lat, form.lng),
        ...parseCaptureCoords(form.captureLat, form.captureLng),
        // An untouched lossy input is not posted as its truncation.
        // `source_posted_at` is dropped (read as "keep", as on the version
        // path); an absent `event_time` clears it, so it goes back at the row's
        // own precision.
        event_time:
          form.eventTime === form.seeded.eventTime
            ? (geo.event_time ?? undefined)
            : form.eventTime || undefined,
        source_posted_at:
          form.sourcePostedAt === form.seeded.sourcePostedAt
            ? ""
            : form.sourcePostedAt,
        remove_media_ids: [...form.removedIds],
        files: form.newFiles,
      }),
    {
      fallback: "Couldn't save this request.",
      onSuccess: () => router.push(redirectTo),
    }
  );

  const busy = saveMutation.loading;

  const attemptSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.reset();
    form.clearIncomplete();
    // A snapshot that cannot be one is caught before the upload.
    if (
      [form.sourceSnapshotUrl, ...form.secondarySnapshotUrls].some(
        (pasted) => pasted.trim() && !isSnapshotUrl(pasted)
      )
    ) {
      saveMutation.setError(SNAPSHOT_HINT);
      return;
    }
    const missing = missingEventRequestFields(
      {
        title: form.title,
        sourceUrl: form.sourceUrl,
        sourcePostedAt: form.sourcePostedAt,
        mediaCount: keptMediaCount,
      },
      { requireSourcePostedAt: false }
    );
    if (missing.length) {
      form.flagIncomplete(missing);
      return;
    }
    void saveMutation.run();
  };

  return (
    <PageShell back backFallback={redirectTo} title="Edit request" actions={actions}>
      {panels}

      {/* `noValidate`: IncompleteFormNotice owns required-field feedback. */}
      <form onSubmit={attemptSave} className="space-y-6" noValidate>
        <EventFormFields
          form={form}
          row={geo}
          showProvenance
          sourcePostedAtRequired={false}
        />

        <IncompleteFormNotice
          key={form.validationAttempt}
          missing={form.missingFields.map((m) => m.label)}
        />
        {saveMutation.error && (
          <div className={FORM_ERROR_BANNER}>{saveMutation.error}</div>
        )}

        {/* No confirm step: the edit publishes nothing and files no version. */}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Saving…" : "Save request"}
        </Button>
      </form>
    </PageShell>
  );
}
