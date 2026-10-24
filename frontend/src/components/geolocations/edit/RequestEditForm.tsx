"use client";

import { useRouter } from "next/navigation";

import {
  EventFormFields,
  useEventForm,
} from "@/components/geolocations/EventFormFields";
import { PageShell } from "@/components/ui/PageShell";
import { sourcesBlockWrite } from "@/components/sources/SourcesField";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { IncompleteFormNotice } from "@/components/ui/IncompleteFormNotice";
import { Button } from "@/components/ui/Button";
import { CloseSection } from "@/components/event/CloseEventForm";
import { useMutation } from "@/hooks/useMutation";
import { missingEventRequestFields, parseGuessCoords, updateEventRequest } from "@/lib/events";
import { sourceFloor, sourceWriteError } from "@/lib/sources";
import type { EventDetail } from "@/types";
import { Card } from "@/components/ui/Card";

// Ties the rail's save button to the form in the main column.
const REQUEST_FORM_ID = "request-edit-form";

/**
 * Owner edit of an open request, the third shape of the one edit address.
 *
 * A request is a question, not a vouched claim, so this write overwrites the row:
 * no version is filed, and the id, requester and bot provenance stay put. The
 * fields are the submit form's request fields, in the shared `EventFormFields`.
 *
 * The fields fill the main column; the save and the close sit in the right rail's
 * actions card, as on the event edit form.
 *
 * The floor is the request floor: a title, and a direct or indirect source with
 * a file, every source with a URL. Placing a coordinate publishes nothing (the
 * geolocate does, through `/submit?request_id=`).
 */
export function RequestEditForm({
  geo,
  redirectTo,
}: {
  geo: EventDetail;
  redirectTo: string;
}) {
  const router = useRouter();
  const form = useEventForm(geo);

  const saveMutation = useMutation(
    () =>
      updateEventRequest(geo.id, {
        ...form.shared(),
        // Both-or-neither parse, so a half-typed pair is dropped, not a 400.
        ...parseGuessCoords(form.lat, form.lng),
      }),
    {
      fallback: "Couldn't save this request.",
      onError: sourceWriteError,
      onSuccess: () => router.push(redirectTo),
    }
  );

  const busy = saveMutation.loading;

  const attemptSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.reset();
    form.clearIncomplete();
    const missing = missingEventRequestFields({
      title: form.title,
      sources: sourceFloor(form.sources),
    });
    if (missing.length) {
      form.flagIncomplete(missing);
      return;
    }
    // A running upload or a refused archived copy holds the write.
    const blocked = sourcesBlockWrite(form.sources);
    if (blocked) {
      saveMutation.setError(blocked);
      return;
    }
    void saveMutation.run();
  };

  return (
    <PageShell
      back
      backFallback={redirectTo}
      title="Edit request"
      rail={
        <Card as="section">
          <IncompleteFormNotice
            key={form.validationAttempt}
            missing={form.missingFields.map((m) => m.label)}
          />
          {saveMutation.error && (
            <div className={FORM_ERROR_BANNER}>{saveMutation.error}</div>
          )}

          {/* No confirm step: the edit publishes nothing and files no version. */}
          <Button type="submit" form={REQUEST_FORM_ID} variant="primary" disabled={busy}>
            {busy ? "Saving…" : "Save request"}
          </Button>

          <CloseSection
            eventId={geo.id}
            status={geo.status}
            disabled={busy}
            onClosed={() => router.push(redirectTo)}
          />
        </Card>
      }
      railLabel="Actions"
      narrowRail="below"
    >
      {/* `noValidate`: IncompleteFormNotice owns required-field feedback. */}
      <form id={REQUEST_FORM_ID} onSubmit={attemptSave} className="space-y-6" noValidate>
        <EventFormFields form={form} row={geo} showProvenance publishes={false} />
      </form>
    </PageShell>
  );
}
