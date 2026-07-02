/**
 * Canonical concept registry for the `?` help affordance (see `FieldHelp`).
 *
 * **One home for every concept.** Each entry pairs the explanation (`text`,
 * shown in the tooltip) with its accessible `label` (the trigger's aria-label).
 * Every `?` across the app — submit forms, geolocation + bounty detail pages,
 * the map panel — renders `<FieldHelp concept="…" />` and reads from here, so a
 * concept reads identically wherever it appears and changing it is a one-line
 * edit. The wording mirrors the field descriptions in `docs/data-model.md`.
 */
export const FIELD_HELP = {
  title: {
    text: "A short, factual description of the place and what happened (e.g. “Strike on a depot, Donetsk”). Not a caption or commentary.",
    label: "What makes a good title?",
  },
  conflict: {
    text: "Which armed conflict this event belongs to.",
    label: "What is the conflict?",
  },
  capture_source: {
    text: "How the footage was captured: drone, dashcam, body / helmet cam, satellite, static camera, or smartphone.",
    label: "What is the capture source?",
  },
  coordinates: {
    text: "Decimal degrees, latitude then longitude (e.g. 48.0159, 37.8024). Where the footage was filmed, not where it was posted.",
    label: "What are the coordinates?",
  },
  source_url: {
    text: "Where the footage was first published (the original post or channel). Not your own geolocation tweet.",
    label: "What is the source?",
  },
  source_media: {
    text: "The footage being located. Not a map screenshot or an annotated export.",
    label: "What is the source media?",
  },
  event_date: {
    text: "When the depicted event happened (from the chyron or context). Not the post date or the date you submit it here.",
    label: "What is the event date?",
  },
  event_time: {
    text: "Optional time-of-day the event happened (UTC), if known from the footage or context. Leave blank when only the day is known.",
    label: "What is the event time?",
  },
  source_posted_at: {
    text: "When the source posted the media (the Telegram / X post date and time, UTC). A post always has a time. Not when the event happened, nor when you submitted it here.",
    label: "What is the source post time?",
  },
  added: {
    text: "When this was added to Vidit. Not when the event happened, nor when the source posted the media.",
    label: "What is the added date?",
  },
  status: {
    text: "Requested: an open call to geolocate this footage. Detected: machine output from a tweet, shown marked until its owner submits it. Geolocated: a person vouched for it (via the form, or by submitting a reviewed detection), not independently verified. Closed: the author withdrew the request.",
    label: "What does the status mean?",
  },
  bounty_status: {
    text: "Requested: waiting for an analyst to geolocate it. Once someone does, it becomes a geolocation. Closed: the author withdrew it.",
    label: "What does the status mean?",
  },
  detected_from: {
    text: "The post this detection was imported from. Its provenance, kept distinct from Source (the footage origin).",
    label: "What is 'detected from'?",
  },
  // Section-level concepts (the `?` next to a section heading).
  section_location: {
    text: "The footage being located, and the coordinates where it was filmed. A bounty has just the footage; whoever picks it up adds the coordinates.",
    label: "What goes in Location?",
  },
  section_import: {
    text: "Paste a public tweet to pre-fill the form: title, source, date, media, and best-effort coordinates. You review everything before submitting.",
    label: "What does importing do?",
  },
  section_details: {
    text: "When the event happened, when the source posted the media, and where it was first published.",
    label: "What goes in Details?",
  },
  section_tags: {
    text: "Conflict and capture source classify the event; add free tags so others can find it.",
    label: "What goes in Tags?",
  },
  section_proof: {
    text: "Your annotated cross-reference between the source media and satellite imagery, showing how the location was matched so others can audit it. On a bounty it's the partial reasoning so far, since the match isn't finished yet.",
    label: "What goes in Proof?",
  },
  // Detection submit action, spelled out here.
  action_submit: {
    text: "Submits this detection: your edits are saved and it becomes Geolocated (a person stands behind it), frozen and no longer editable. Give it a full read first.",
    label: "What does Submit do?",
  },
} as const;

/** A concept key — the single argument every `<FieldHelp>` takes. */
export type Concept = keyof typeof FIELD_HELP;
