/**
 * Canonical concept registry for the `?` help affordance (see `FieldHelp`).
 *
 * **One home for every concept.** Each entry pairs the explanation (`text`,
 * shown in the tooltip) with its accessible `label` (the trigger's aria-label).
 * Every `?` across the app (submit forms, geolocation + request detail pages,
 * the map panel) renders `<FieldHelp concept="…" />` and reads from here, so a
 * concept reads identically wherever it appears and changing it is a one-line
 * edit. The wording mirrors the field descriptions in `docs/data-model.md`.
 */
export const FIELD_HELP = {
  title: {
    text: "A short, factual description of the place and what happened (e.g. “Strike on a depot, Donetsk”). Not a caption or commentary.",
    label: "What makes a good title?",
  },
  conflict: {
    text: "Which armed conflict this event belongs to. The list mirrors Wikipedia's list of ongoing armed conflicts (synced daily; the default suggestions are its major wars), and historical conflicts since 1914 are available via “Include ended conflicts”. Pick “Other” for anything not listed.",
    label: "What is the conflict?",
  },
  capture_source: {
    text: "How the footage was captured: drone, dashcam, body / helmet cam, satellite, static camera, or smartphone.",
    label: "What is the capture source?",
  },
  coordinates: {
    text: "Decimal degrees, latitude then longitude (e.g. 48.0159, 37.8024). The subject: the ground location the footage shows, not where the camera was or where it was posted.",
    label: "What are the coordinates?",
  },
  capture_source_coords: {
    text: "Optional. Where the camera was, in decimal degrees (latitude then longitude), when that's a different spot from the subject: e.g. a drone or a rooftop looking down at the strike. Leave blank when the camera was at the subject, or the vantage point is unknown.",
    label: "What is the camera position?",
  },
  source_url: {
    text: "Where the footage was first published (the original post or channel). Not your own geolocation tweet.",
    label: "What is the source?",
  },
  secondary_source_urls: {
    text: "Optional. Mirrors of the same media: the same footage posted on another network, or another post of it from the same point of view. The Source above stays the first place it was published.",
    label: "What are secondary sources?",
  },
  archived_copies: {
    text: "An archived copy of a source link, so the evidence survives the original being deleted. You make it yourself: on your own events the greyed icon opens the Wayback Machine with the link filled in, and you paste the snapshot it gives you back. A snapshot you took at archive.ph or archive.today is accepted in the same field. Orange means a copy exists and opens it; grey means none yet.",
    label: "What are the archived copies?",
  },
  source_media: {
    text: "The footage being located. Not a map screenshot or an annotated export.",
    label: "What is the source media?",
  },
  event_date: {
    text: "When the depicted event happened (from the chyron or context). Not the post date or the date you submit it here. Leave blank when the footage doesn't establish it; it then reads as Unknown.",
    label: "What is the event date?",
  },
  event_time: {
    text: "Optional time-of-day the event happened (UTC), if known from the footage or context. Leave blank when only the day is known.",
    label: "What is the event time?",
  },
  source_posted_at: {
    text: "When the source posted the media (the Telegram / X post date and time, UTC). Required to publish; a machine-detected draft can still have it blank when the source's post time wasn't resolved, and you fill it in before submitting. Not when the event happened, nor when you submitted it here.",
    label: "What is the source post time?",
  },
  added: {
    text: "When this was added to Vidit. Not when the event happened, nor when the source posted the media.",
    label: "What is the added date?",
  },
  status: {
    text: "Requested: an open call to geolocate this footage. Detected: machine output from a tweet, shown marked until its owner submits it. Geolocated: a person vouched for it (via the form, or by submitting a reviewed detection), not independently verified. Closed: the request was withdrawn, or the detection was rejected.",
    label: "What does the status mean?",
  },
  request_status: {
    text: "Requested: waiting for an analyst to geolocate it. Once someone does, it becomes a geolocation. Closed: the author withdrew it.",
    label: "What does the status mean?",
  },
  detected_from: {
    text: "The post this detection was imported from. Its provenance, kept distinct from Source (the footage origin).",
    label: "What is 'detected from'?",
  },
  requested_by: {
    text: "The analyst who opened this as a request. The row stays after fulfilment, as the trace of where the event came from.",
    label: "Who requested this?",
  },
  author: {
    text: "The analyst who owns this entry on Vidit: the geolocation's submitter, or the analyst who opened it while it is a request. Not necessarily whoever filmed or posted the source.",
    label: "Who is the author?",
  },
  // Section-level concepts (the `?` next to a section heading).
  section_location: {
    text: "The footage being located, and the coordinates of the subject it shows. A request has just the footage; whoever picks it up adds the coordinates.",
    label: "What goes in Location?",
  },
  section_import: {
    text: "Paste one of your own X posts and we read it into a draft: the coordinates, the source, the media and the title. Own posts only, matched against the X account linked to your profile. You review the draft before publishing.",
    label: "What does importing do?",
  },
  section_details: {
    text: "When the event happened, when the source posted the media, and where it was first published.",
    label: "What goes in Details?",
  },
  section_classification: {
    text: "Conflict and capture source classify the event; add free tags so others can find it.",
    label: "What goes in Classification?",
  },
  section_proof: {
    text: "Your annotated cross-reference between the source media and satellite imagery, showing how the location was matched so others can audit it. On a request it's the partial reasoning so far, since the match isn't finished yet.",
    label: "What goes in Proof?",
  },
  // Detections queue: the filter over the page.
  detection_queue_filter: {
    text: "Ready: the import left the draft with every piece of evidence a publish needs, so a review adds the conflict and the capture source, then publishes it. Incomplete: the import left a required piece missing (the source URL, the coordinates, the source media, or a proof image), so it needs a manual pass on the form before it can be published.",
    label: "What does this filter select?",
  },
  // Detection submit action, spelled out here.
  action_submit: {
    text: "Submits this detection: your edits are saved and it becomes Geolocated (a person stands behind it). Submitting freezes the event, so it can no longer be edited. Give it a full read first, then click Submit twice to confirm.",
    label: "What does Submit do?",
  },
} as const;

/** A concept key — the single argument every `<FieldHelp>` takes. */
export type Concept = keyof typeof FIELD_HELP;
