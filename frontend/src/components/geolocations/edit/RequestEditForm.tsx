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
 * A request is a question rather than a vouched claim, so this write overwrites
 * the row: no version is filed, the id, the requester and the provenance of a
 * bot-opened row stay put, and the owner lands back on the request. The fields
 * are the ones the submit form writes when it posts a request, the shared
 * `EventFormFields` block in the same order, so an analyst who opened a request
 * by hand edits it in the surface they filled.
 *
 * The floor is the request floor, not the geolocation one: a title, the source,
 * and the footage. The coordinate is what a request is asking for, so placing
 * one here does not publish anything; the geolocate does, through
 * `/submit?request_id=`. The source instant is not part of the floor on this
 * surface, since the bot opens requests whose source date it could not read.
 */
export function RequestEditForm({
  geo,
  redirectTo,
}: {
  geo: EventDetail;
  redirectTo: string;
}) {
  const router = useRouter();
  // No tier on this surface, the shape the published edit form takes: the flow
  // action is the Save at the foot of the fields it applies, and sharing or
  // reporting a row one is in the middle of rewriting acts on a record that is
  // not the one on screen. The call stays because the grammar decides that, not
  // the form.
  const { actions, panels } = useEventActions({ event: geo, surface: "edit" });

  // A `requested` row always carries a source URL (`ck_events_source_url_status`
  // ties it to the status), so the block's `?? ""` seed only satisfies the
  // nullable wire type here.
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
        // The optional guess and the optional camera point, on the same strict
        // both-or-neither parse the submit form runs, so a half-typed pair is
        // dropped rather than posted as a 400.
        ...parseGuessCoords(form.lat, form.lng),
        ...parseCaptureCoords(form.captureLat, form.captureLng),
        // An untouched lossy input is not posted as the truncation it holds: the
        // row's own value goes back instead, at the precision it was stored in.
        event_time:
          form.eventTime === form.seeded.eventTime
            ? (geo.event_time ?? undefined)
            : form.eventTime || undefined,
        source_posted_at:
          form.sourcePostedAt === form.seeded.sourcePostedAt
            ? (geo.source_posted_at ?? "")
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
    // A pasted snapshot that cannot be one, on the source or on any mirror, is
    // caught before the upload: the field flags itself red and the banner says
    // what a snapshot link looks like.
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
      {/* Under the header, where the trigger that opened it is. */}
      {panels}

      {/* `noValidate`: the shared IncompleteFormNotice owns required-field
          feedback, so the browser's native validation must not preempt it. */}
      <form onSubmit={attemptSave} className="space-y-6" noValidate>
        <EventFormFields form={form} row={geo} showProvenance />

        {/* Validation + errors sit right above the action: the notice lists
            every missing field at once, the banner carries server failures. */}
        <IncompleteFormNotice
          key={form.validationAttempt}
          missing={form.missingFields.map((m) => m.label)}
        />
        {saveMutation.error && (
          <div className={FORM_ERROR_BANNER}>{saveMutation.error}</div>
        )}

        {/* The flow action, alone at the foot of the fields it applies. No
            confirm step: the edit publishes nothing and files no version, which
            is the ordinary way an open request changes. */}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Saving…" : "Save request"}
        </Button>
      </form>
    </PageShell>
  );
}
