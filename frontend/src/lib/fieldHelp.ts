/**
 * Canonical concept registry for the `?` help affordance (see `FieldHelp`): each entry pairs
 * the tooltip `text` with the trigger's aria `label`, so a concept reads identically
 * everywhere. The wording mirrors the field descriptions in `docs/data-model.md`.
 */
export const FIELD_HELP = {
  title: {
    text: "A short, factual description of the place and what happened (e.g. “Strike on a depot, Donetsk”). Not a caption or commentary.",
    label: "What makes a good title?",
  },
  conflict: {
    text: "Which armed conflict this event belongs to. The list mirrors Wikipedia's list of ongoing armed conflicts (synced daily), and historical conflicts since 1914 are available via “Include ended conflicts”. Pick “Other” for anything not listed.",
    label: "What is the conflict?",
  },
  sources: {
    text: "The evidence: one block per source, none of them the main one. A source is one file and the URLs it was posted at. Publishing needs a direct or indirect source with a file; a context source may be a URL only. Add another source for other footage of the same event. When two sources hold the same footage, move the links onto one and remove the other.",
    label: "What are sources?",
  },
  source_level: {
    text: "Direct: the act while it happens. Indirect: its direct consequences, after the fact (smoke, damage, wreckage). Context: anything else, such as an image from before, a portrait that identifies a victim, or an article or statement without media.",
    label: "What is the evidence level?",
  },
  source_kind: {
    text: "Where the source comes from: what captured it (smartphone, camera, static camera such as CCTV or a webcam, drone, aircraft such as a plane or a helicopter (historical aerial photos included), satellite, dashcam, or body / helmet cam), or an article, an official statement or something else. Whether the file is a photo or a video comes from the file itself. Pick Unknown when the source does not say. Required on every source.",
    label: "What is the source kind?",
  },
  source_file: {
    text: "The footage or picture being located, uploaded as soon as you pick it. Not a map screenshot or an annotated export.",
    label: "What is the source file?",
  },
  captured_at: {
    text: "Optional. When the file was captured (UTC), if known. Not when it was posted, nor when the event was added here.",
    label: "What is the capture time?",
  },
  capture_position: {
    text: "Optional. Where the capture was made from, in decimal degrees (latitude then longitude), when that's a different spot from the subject: e.g. a drone or a rooftop looking down at the strike. Leave blank when the capture was made at the subject, or the vantage point is unknown. An article, an official statement or another document has none.",
    label: "What is the capture position?",
  },
  source_links: {
    text: "Where the file was posted: the original post or channel first, then each mirror of the same file. Not your own geolocation post. Each link takes its post time (UTC) when known. The archive mark beside a link is its archived copy, so the evidence survives the post being deleted: orange opens the stored copy, grey means there is none yet. The form's mark offers the Wayback Machine with the link filled in and accepts a snapshot from the Wayback Machine, archive.today (or any of its mirrors) or Ghostarchive. On a satellite or aircraft source, link the provider's permalink that reopens the same image at its capture date: the form names the provider, how to reopen it and its credit, and warns when a reader could not reopen the image.",
    label: "What are the source links?",
  },
  coordinates: {
    text: "Decimal degrees, latitude then longitude (e.g. 48.0159, 37.8024). The subject: the ground location the footage shows, not where the capture was made from or where it was posted.",
    label: "What are the coordinates?",
  },
  occurred_date: {
    text: "When the depicted event happened (from the chyron or context). Not the post date or the date you submit it here. Leave blank when the footage doesn't establish it; it then reads as Unknown.",
    label: "What is the event date?",
  },
  occurred_time: {
    text: "Optional time-of-day the event happened (UTC), if known from the footage or context. Leave blank when only the day is known.",
    label: "What is the event time?",
  },
  added: {
    text: "When this was added to Vidit. Not when the event happened, nor when a source posted the media.",
    label: "What is the added date?",
  },
  status: {
    text: "Requested: an open call to geolocate this footage. Detected: machine output from a tweet, shown marked until its owner submits it. Geolocated: a person vouched for it (via the form, or by submitting a reviewed detection), not independently verified. Closed: the request was withdrawn, the detection was rejected, or the published geolocation was retracted by its author, whose page stays up with the reason.",
    label: "What does the status mean?",
  },
  detected_from: {
    text: "The post this entry was read from: the detection was imported from it, or the request was opened from it. Its provenance, kept distinct from the sources (where the footage was posted).",
    label: "Where was this read from?",
  },
  requested_by: {
    text: "The analyst who opened this as a request. The row stays after fulfilment, as the trace of where the event came from.",
    label: "Who requested this?",
  },
  section_location: {
    text: "The footage being located, and the coordinates of the subject it shows. A request has just the footage; whoever picks it up adds the coordinates.",
    label: "What goes in Location?",
  },
  section_import: {
    text: "Vidit reads one of your own X posts into a detection you review before publishing; the import guide states what it reads.",
    label: "What does importing do?",
  },
  section_details: {
    text: "When the event happened, as a date and a time of day (UTC), each optional. The conflict classifies the event; add tags so others can find it.",
    label: "What goes in Details?",
  },
  section_proof: {
    text: "Your annotated cross-reference between the source media and satellite imagery, showing how the location was matched so others can audit it. On a request it's the partial reasoning so far, since the match isn't finished yet.",
    label: "What goes in Proof?",
  },
  detection_queue_filter: {
    text: "Ready: the import left the detection with every piece of evidence a publish needs, so a review adds the conflict and the source kind, then publishes it. Incomplete: the import left a required piece missing (a source URL, the coordinates, a source file, or a proof image), so it needs a manual pass on the form before it can be published.",
    label: "What does this filter select?",
  },
  version_note: {
    text: "Optional. One line on what you changed and why, kept with the version this edit replaces so a reader can follow the correction.",
    label: "What is the version note?",
  },
  geolocators: {
    text: "An invited analyst is credited once they accept. Editing and closing stay with the owner. Invites, withdrawals and removals apply right away and do not create a new version.",
    label: "How does shared credit work?",
  },
  close_geolocation: {
    text: "Closing takes this geolocation back. It stays readable, with your reason beside it.",
    label: "What does closing do?",
  },
  close_detection: {
    text: "Closing takes this detection back. It stays readable, with your reason beside it.",
    label: "What does closing do?",
  },
  close_request: {
    text: "Closing takes this request back. It stays readable, with your reason beside it.",
    label: "What does closing do?",
  },
  close_reason: {
    text: "The reason stays publicly visible next to the closed badge.",
    label: "Who sees the close reason?",
  },
  action_publish: {
    text: "Publishes this event with your edits: it becomes a geolocation (a person stands behind it), public, at version 1. The request or detection it was stays readable in its history as version 0, and every later change is kept as a new version. Publishing a request makes you its owner. Give it a full read first, then click Publish twice to confirm.",
    label: "What does Publish do?",
  },
  geolocate_request: {
    text: "Opens this request in the edit form, its sources filled in. Publishing it answers the request, and you become the owner of the event.",
    label: "What does Geolocate do?",
  },
  report_reason: {
    text: "The kind of problem you report. An admin reads every report and decides what happens to what it flags. Pick the closest fit.",
    label: "Which reason fits?",
  },
  report_details: {
    text: "Optional. Anything an admin needs to judge the report, in your own words. The reason is often the whole report.",
    label: "What goes in the details?",
  },
  approval: {
    text: "An approval means an analyst or an organization checked this geolocation and agrees with it. It covers one version: when the event gets a new version, approvers are asked to approve again. An approval is final.",
    label: "What is an approval?",
  },
  approval_filter: {
    text: "Keeps the events whose current version holds an approval: any approval, or the one an analyst or an organization gave. An approval of an earlier version does not count.",
    label: "Which approvals count?",
  },
  last_org_manager: {
    text: "The last org manager cannot leave, be removed or become a member. Make another member org manager first.",
    label: "Why can the last org manager not leave?",
  },
} as const;

/** A concept key: the single argument every `<FieldHelp>` takes. */
export type Concept = keyof typeof FIELD_HELP;
