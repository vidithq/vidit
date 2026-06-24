/**
 * Canonical field-guidance copy for the `?` help tooltips (see `FieldHelp`).
 *
 * One home: the wording mirrors the field descriptions in
 * `docs/data-model.md`. Each line states what belongs in the field and the
 * mistake to avoid.
 */
export const FIELD_HELP = {
  title:
    "A short, factual description — the place and what happened (e.g. “Strike on a depot, Donetsk”). Not a caption or commentary.",
  conflict: "Which armed conflict this event belongs to.",
  capture_source:
    "How the footage was captured — drone, dashcam, body / helmet cam, satellite, static camera, smartphone.",
  coordinates:
    "Decimal degrees — latitude then longitude (e.g. 48.0159, 37.8024). Where the footage was filmed, not where it was posted.",
  source_url:
    "Where the footage was first published — the original post or channel. Not your own geolocation tweet.",
  source_media:
    "The footage being located — not a map screenshot or an annotated export.",
  event_date:
    "When the depicted event happened (from the chyron or context) — not the post or the geolocation date.",
  status:
    "Validated: submitted or vouched for by a human. Detected: produced by the machine from a tweet, shown marked until its owner validates it.",
  bounty_status:
    "Open: waiting for an analyst to geolocate it. Fulfilled: a geolocation was submitted and the bounty archived. Closed: the author withdrew it.",
  detected_from:
    "The post this detection was imported from — its provenance, kept distinct from Source (the footage origin).",
} as const;
