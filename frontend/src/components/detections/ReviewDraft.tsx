"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";

import { CloseEventForm } from "@/components/event/CloseEventForm";
import { CoordinateInputs } from "@/components/geolocations/CoordinateInputs";
import { TitleField } from "@/components/geolocations/TitleField";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { IncompleteFormNotice } from "@/components/ui/IncompleteFormNotice";
import { Input, Select } from "@/components/ui/Input";
import { MediaGallery } from "@/components/ui/MediaGallery";
import { ProofSection } from "@/components/ui/ProofSection";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ConflictTypeahead } from "@/components/ui/TagPicker";
import { FORM_ERROR_BANNER, FORM_LABEL } from "@/components/ui/form-styles";
import { TEXT_LINK } from "@/components/ui/styles";
import { useDetectionsCount } from "@/contexts/DetectionsContext";
import { useIncompleteForm } from "@/hooks/useIncompleteForm";
import { useMutation } from "@/hooks/useMutation";
import { cleanNumber, coordinatePair } from "@/lib/coordinates";
import {
  geolocateEvent,
  missingEventFields,
  parseCaptureCoords,
  type EventFieldsState,
  type MissingFieldKey,
} from "@/lib/events";
import { toDatetimeLocalUTC } from "@/lib/format";
import { renderProof } from "@/lib/proof";
import type { Conflict, EventDetail, Tag } from "@/types";

// Same dynamic mount as every other map surface: MapLibre needs a DOM, so the
// canvas never server-renders.
const Map = dynamic(() => import("@/components/map/Map"), { ssr: false });

/** The `missingEventFields` keys a review cannot supply: evidence the import
 *  either carried or did not (the source, its post time, the footage, the
 *  annotated proof). A draft missing one of these is shown the gap, Publish is
 *  disabled, and Skip moves on; closing it means a pass on the full edit form.
 *  Everything else on the floor (title, coordinates, conflict, capture source)
 *  is exactly what the review writes. */
const REVIEW_BLOCKING_KEYS: ReadonlySet<MissingFieldKey> = new Set([
  "source_url",
  "source_posted_at",
  "proof",
  "proof_image",
  "source_media",
]);

/** Whether a keystroke is the analyst typing into a field rather than driving
 *  the queue. The shortcuts are single letters, so they stay off while a field
 *  holds focus. */
function typingInField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)
  );
}

interface ReviewDraftProps {
  draft: EventDetail;
  /** The conflicts referential, filtered client-side by the typeahead. */
  conflicts: Conflict[];
  /** The curated `capture_source` rows, the pick-one list below. */
  captureSources: Tag[];
  /** The sticky conflict pick, carried from the previous draft. */
  conflictIds: string[];
  setConflictIds: Dispatch<SetStateAction<string[]>>;
  /** The sticky capture-source pick, carried from the previous draft. */
  captureSourceId: string;
  setCaptureSourceId: (id: string) => void;
  /** Move to the next draft: after a publish, a skip, or a disposal. */
  onAdvance: () => void;
}

/**
 * One draft under review: the evidence on the left, the point on the map on the
 * right, then the handful of fields a publish needs.
 *
 * Publishing runs the single-row `POST /events/{id}/geolocate` transition, so
 * the server floor, the geolocator credit and the archival enqueue are the ones
 * a submit from the full form gets. The draft keeps every field the review does
 * not touch: its source, its media, its proof body and its free tags all post
 * back unchanged, and only the title, the point, the event date, the conflict
 * and the capture source are the review's own.
 *
 * Per-draft state is seeded from props, so the parent gives this a `key` of the
 * draft id and a new draft arrives with clean fields. The two picks are the
 * exception: they live in the parent and stick across drafts.
 */
export function ReviewDraft({
  draft,
  conflicts,
  captureSources,
  conflictIds,
  setConflictIds,
  captureSourceId,
  setCaptureSourceId,
  onAdvance,
}: ReviewDraftProps) {
  const { refresh: refreshDetectionCount } = useDetectionsCount();

  const [title, setTitle] = useState(draft.title);
  const [eventDate, setEventDate] = useState(draft.event_date ?? "");
  // The point is adjustable and saves with the publish. A draft carries one
  // whenever the import found a location; otherwise the pair starts empty.
  const [lat, setLat] = useState(
    draft.event_coords ? String(draft.event_coords.lat) : ""
  );
  const [lng, setLng] = useState(
    draft.event_coords ? String(draft.event_coords.lng) : ""
  );
  const [disposing, setDisposing] = useState(false);

  // The typed pair as a real point, or null while it is half-typed or out of
  // bounds. The same parse the coordinate inputs use for their own verification
  // affordances, so the pin and the fields can't disagree about what counts.
  const point = coordinatePair(lat, lng);

  // The rendered proof body, or nothing to show: an import that found no
  // annotation media still stores an empty document, so "has a proof field" is
  // not "has something to read". The renderer's own answer settles it.
  const rendered = draft.proof ? renderProof(draft.proof) : null;
  const proofBody =
    Array.isArray(rendered) && rendered.length === 0 ? null : rendered;

  const { missingFields, invalidKeys, validationAttempt, flagIncomplete, clearIncomplete } =
    useIncompleteForm();

  const fields: EventFieldsState = {
    title,
    lat,
    lng,
    sourceUrl: draft.source_url ?? "",
    sourcePostedAt: toDatetimeLocalUTC(draft.source_posted_at),
    proof: draft.proof,
    // `EventRead.media` carries the event's source attachments only, so the
    // length is the source-media count the floor asks for.
    mediaCount: draft.media.length,
    hasConflictTag: conflictIds.length > 0,
    hasCaptureSourceTag: captureSourceId !== "",
  };
  const missing = missingEventFields(fields);
  const blockers = missing.filter((m) => REVIEW_BLOCKING_KEYS.has(m.key));

  const buildInput = () => ({
    title: title.trim(),
    lat: cleanNumber(lat) ?? NaN,
    lng: cleanNumber(lng) ?? NaN,
    // The camera point rides back untouched: the review doesn't offer it, and
    // omitting it would drop what the import found.
    ...parseCaptureCoords(
      draft.capture_source_coords ? String(draft.capture_source_coords.lat) : "",
      draft.capture_source_coords ? String(draft.capture_source_coords.lng) : ""
    ),
    source_url: draft.source_url ?? "",
    secondary_source_urls: draft.secondary_source_urls,
    event_date: eventDate || undefined,
    event_time: draft.event_time?.slice(0, 5) || undefined,
    source_posted_at: toDatetimeLocalUTC(draft.source_posted_at),
    proof: draft.proof,
    // The tag set posts back whole, so the draft's own tags survive and only
    // the capture source is replaced by the pick (an import may have carried
    // one of its own).
    tag_ids: [
      ...draft.tags.filter((t) => t.category !== "capture_source").map((t) => t.id),
      captureSourceId,
    ],
    conflict_ids: conflictIds,
    remove_media_ids: [],
    files: [],
    proof_files: [],
  });

  const publish = useMutation(() => geolocateEvent(draft.id, buildInput()), {
    fallback: "Couldn't publish this draft.",
    onSuccess: () => {
      refreshDetectionCount();
      onAdvance();
    },
  });

  const busy = publish.loading;

  const attemptPublish = () => {
    if (blockers.length > 0 || busy) return;
    publish.reset();
    clearIncomplete();
    if (missing.length > 0) {
      flagIncomplete(missing);
      return;
    }
    void publish.run();
  };

  // Enter / S / X drive the queue from the keyboard, since a review session is
  // dozens of identical passes. They stay off while a field holds focus (they
  // are single letters) and while the disposal panel is open, where the only
  // sensible actions are its own confirm and cancel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (disposing || typingInField(e.target)) return;
      const key = e.key.toLowerCase();
      if (e.key === "Enter") {
        e.preventDefault();
        attemptPublish();
      } else if (key === "s") {
        e.preventDefault();
        onAdvance();
      } else if (key === "x") {
        e.preventDefault();
        setDisposing(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="space-y-4">
      {/* Evidence on one side, the point on the other. One column on a phone:
          the review is a desktop-first surface, and stacking is what keeps it
          usable rather than broken at 375px. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <SectionEyebrow title="Source media" />
            <MediaGallery
              media={draft.media}
              alt={draft.title}
              isGraphic={draft.is_graphic}
              variant="panel"
            />
          </div>
          <ProofSection>
            {proofBody ? (
              <div className="max-h-96 overflow-y-auto">{proofBody}</div>
            ) : (
              <p className="text-sm text-neutral-500">This draft carries no proof.</p>
            )}
          </ProofSection>
        </div>

        <Card as="section">
          <SectionHeading title="Location" concept="section_location" />
          {/* The pin follows the coordinate pair as it is edited, so the map is
              the read on a point the inputs own. `overflow-hidden` clips the
              canvas to the rounded box; the camera is framed on mount, since a
              re-frame on every keystroke would fight a half-typed value.
              Single-point tuple: the two date slots are inert here. */}
          <div className="h-64 overflow-hidden rounded-md sm:h-80">
            <Map
              points={
                point ? [[draft.id, point.lat, point.lng, "", "", 1]] : []
              }
              center={point ?? undefined}
              zoom={9}
            />
          </div>
          <CoordinateInputs
            lat={lat}
            setLat={setLat}
            lng={lng}
            setLng={setLng}
            invalid={invalidKeys.has("coordinates")}
          />
        </Card>
      </div>

      <Card as="section">
        <SectionHeading title="Publish this draft" concept="section_review" />

        <TitleField value={title} onChange={setTitle} invalid={invalidKeys.has("title")} />

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="event_date" className={FORM_LABEL}>
              Event date <FieldHelp concept="event_date" />
            </label>
            <Input
              id="event_date"
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className={eventDate ? "has-value" : ""}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="capture_source" className={FORM_LABEL}>
              Capture source <FieldHelp concept="capture_source" />
            </label>
            <Select
              id="capture_source"
              value={captureSourceId}
              invalid={invalidKeys.has("capture_source_tag")}
              onChange={(e) => setCaptureSourceId(e.target.value)}
            >
              <option value="">Pick one…</option>
              {captureSources.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <span className={FORM_LABEL}>
            Conflict <FieldHelp concept="conflict" />
          </span>
          <ConflictTypeahead
            conflicts={conflicts}
            selectedIds={conflictIds}
            setSelectedIds={setConflictIds}
          />
        </div>
        <p className="text-xs text-neutral-500">
          The conflict and capture source you pick here carry to the next draft.
        </p>
      </Card>

      {blockers.length > 0 && (
        <div className={FORM_ERROR_BANNER} role="alert">
          <p>
            This draft can&apos;t be published from here: it is missing{" "}
            {blockers.map((m) => m.label.toLowerCase()).join(", ")}. Skip it, or{" "}
            <Link href={`/events/${draft.id}/edit`} className={TEXT_LINK}>
              open the full form
            </Link>{" "}
            to fill it in.
          </p>
        </div>
      )}
      <IncompleteFormNotice
        key={validationAttempt}
        missing={missingFields.map((m) => m.label)}
      />
      {publish.error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {publish.error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5">
          <Button
            variant="primary"
            onClick={attemptPublish}
            disabled={busy || blockers.length > 0}
          >
            {publish.loading ? "Publishing…" : "Publish"}
          </Button>
          <FieldHelp concept="action_submit" />
        </span>
        <Button variant="secondary" onClick={onAdvance} disabled={busy}>
          Skip
        </Button>
        {!disposing && (
          <Button
            variant="danger"
            onClick={() => setDisposing(true)}
            disabled={busy}
            className="ml-auto"
          >
            Reject detection
          </Button>
        )}
      </div>

      {disposing && (
        <div className="border-t border-neutral-800 pt-4">
          <CloseEventForm
            eventId={draft.id}
            status={draft.status}
            disabled={busy}
            onClosed={() => {
              refreshDetectionCount();
              onAdvance();
            }}
            onCancel={() => setDisposing(false)}
          />
        </div>
      )}
    </div>
  );
}
