/**
 * Canonical field-guidance copy for the `?` help tooltips (see `FieldHelp`).
 *
 * One home: the wording mirrors the field descriptions in
 * `docs/data-model.md`. Each line states what belongs in the field and the
 * mistake to avoid.
 */
export const FIELD_HELP = {
  title:
    "A short, factual description of the place and what happened (e.g. “Strike on a depot, Donetsk”). Not a caption or commentary.",
  conflict: "Which armed conflict this event belongs to.",
  capture_source:
    "How the footage was captured: drone, dashcam, body / helmet cam, satellite, static camera, or smartphone.",
  coordinates:
    "Decimal degrees, latitude then longitude (e.g. 48.0159, 37.8024). Where the footage was filmed, not where it was posted.",
  source_url:
    "Where the footage was first published (the original post or channel). Not your own geolocation tweet.",
  source_media:
    "The footage being located. Not a map screenshot or an annotated export.",
  event_date:
    "When the depicted event happened (from the chyron or context). Not the post date or the date you submit it here.",
  source_date:
    "When the source posted the media (the Telegram / X post date). Not when the event happened, nor when you submitted it here.",
  status:
    "Validated: submitted or vouched for by a human. Detected: produced by the machine from a tweet, shown marked until its owner validates it.",
  bounty_status:
    "Open: waiting for an analyst to geolocate it. Fulfilled: a geolocation was submitted and the bounty archived. Closed: the author withdrew it.",
  detected_from:
    "The post this detection was imported from. Its provenance, kept distinct from Source (the footage origin).",
  // Section-level guidance (the `?` next to a section heading).
  section_location:
    "The footage being located, and the coordinates where it was filmed. A bounty has just the footage; whoever picks it up adds the coordinates.",
  section_import:
    "Paste a public tweet to pre-fill the form: title, source, date, media, and best-effort coordinates. You review everything before submitting.",
  section_details:
    "When the event happened, when the source posted the media, and where it was first published.",
  section_tags:
    "Conflict and capture source classify the event; add free tags so others can find it.",
  section_proof:
    "Your annotated cross-reference between the source media and satellite imagery, showing how the location was matched so others can audit it.",
} as const;
