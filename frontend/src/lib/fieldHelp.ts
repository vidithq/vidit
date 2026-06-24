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
  source_date: {
    text: "When the source posted the media (the Telegram / X post date). Not when the event happened, nor when you submitted it here.",
    label: "What is the source date?",
  },
  submitted_date: {
    text: "When this was added to Vidit. Not when the event happened, nor when the source posted the media.",
    label: "What is the submitted date?",
  },
  status: {
    text: "Validated: submitted or vouched for by a human. Detected: produced by the machine from a tweet, shown marked until its owner validates it.",
    label: "What does the status mean?",
  },
  bounty_status: {
    text: "Open: waiting for an analyst to geolocate it. Fulfilled: a geolocation was submitted and the bounty archived. Closed: the author withdrew it.",
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
    text: "Your annotated cross-reference between the source media and satellite imagery, showing how the location was matched so others can audit it.",
    label: "What goes in Proof?",
  },
} as const;

/** A concept key — the single argument every `<FieldHelp>` takes. */
export type Concept = keyof typeof FIELD_HELP;
