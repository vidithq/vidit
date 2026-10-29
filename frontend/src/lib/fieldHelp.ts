import { MAP_SOURCES } from "@/components/map/mapSources";

import { NOTIFICATION_KIND_COPY, type NotificationKind } from "./notifications";

/** One concept's help: the tooltip `text`, the trigger's aria `label`, and the `sources` linked
 *  after the text, for a concept whose data comes from outside Vidit. */
export interface HelpEntry {
  text: string;
  label: string;
  sources?: readonly { name: string; href: string }[];
}

/** One concept per notification kind, its email switch's help: the kind's `setting` sentence. */
const NOTIFICATION_HELP = Object.fromEntries(
  Object.entries(NOTIFICATION_KIND_COPY).map(([kind, { label, setting }]) => [
    `notification_${kind}`,
    { text: setting, label: `What is the ${label} notification?` },
  ]),
) as Record<`notification_${NotificationKind}`, HelpEntry>;

const { openFreeMap, openStreetMap, openMapTiles } = MAP_SOURCES;
const VIDIT_STYLE = [openFreeMap, openStreetMap] as const;
const OPENSTREETMAP_LAYER = [openStreetMap, openMapTiles] as const;

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
  collection_title: {
    text: "A short name for the set, such as the operation or the place it reconstructs (e.g. “Kupiansk rail corridor: three days of strikes”). The description says what it holds.",
    label: "What makes a good collection title?",
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
  graphic_content: {
    text: "Blurs this source's file behind an age confirmation for viewers. Flag footage showing death, injury or human remains. Once a source is saved flagged, only an admin removes the flag: ask a moderator to review it.",
    label: "What does the graphic flag do?",
  },
  source_file: {
    text: "The footage or picture being located, uploaded as soon as you pick it. Not a map screenshot or an annotated export.",
    label: "What is the source file?",
  },
  captured_at: {
    text: "Optional. When the file was captured (UTC), if known. Not when it was posted, nor when the event was added here. Give it on a satellite or aircraft image: a reader reopens the same image at that date.",
    label: "What is the capture time?",
  },
  capture_position: {
    text: "Optional. Where the capture was made from, in decimal degrees (latitude then longitude), when that's a different spot from the subject: e.g. a drone or a rooftop looking down at the strike. Leave blank when the capture was made at the subject, or the vantage point is unknown. An article, an official statement or another document has none.",
    label: "What is the capture position?",
  },
  source_links: {
    text: "Where the file was posted: the original post first, then each mirror, never your own geolocation post. The archive mark beside a link opens its archived copy, which keeps the evidence once the post is deleted, and greys out while there is none.",
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
  action_submit: {
    text: "Publish geolocation makes this event public as a geolocation, under your name, at version 1: it needs the coordinates, the proof and the conflict on top of the sources. Publish request makes it public as a request that anyone can geolocate. Click a button twice to confirm.",
    label: "What do the publish buttons do?",
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
  x_handle: {
    text: "The Vidit bot and the archive import credit posts from this handle to your account. An admin links it.",
    label: "What is the X handle for?",
  },
  invite_analysts: {
    text: "Each invite code is single use and bound to the invitee's X handle, which their new account links on sign-up. Share the link with the analyst you invite.",
    label: "How do invite codes work?",
  },
  display_settings: {
    text: "Saved to your account and applied wherever you sign in.",
    label: "Where do display settings apply?",
  },
  help_tooltips: {
    text: "The small ? icons that explain each field and section. Turn them off once you know the form.",
    label: "What are help tooltips?",
  },
  light_mode: {
    text: "Switches the interface and the map to a light background. Dark by default.",
    label: "What does light mode change?",
  },
  accent_color: {
    text: "The highlight color for buttons, links, selected states and map points.",
    label: "What is the accent color?",
  },
  notification_settings: {
    text: "Every notification appears in your Notifications feed. Each switch chooses whether Vidit also sends that kind to your email address.",
    label: "Which notifications reach my email?",
  },
  approval_request_audience: {
    text: "Who can ask you to approve their geolocation.",
    label: "Who can send me approval requests?",
  },
  ...NOTIFICATION_HELP,
  site_last_source: {
    text: "The capture date and the imagery provider of the most recent source filed on the site. Vidit says when the place was last seen, never whether it is in use today.",
    label: "What is the last source?",
  },
  site_name: {
    text: "A short name for the place, such as the base or the depot it is. Only the site's owner renames it, and every earlier name stays in its history.",
    label: "What makes a good site name?",
  },
  site_kind: {
    text: "What kind of place the site is. Only its owner changes it.",
    label: "What is the site kind?",
  },
  site_location: {
    text: "The site's zone on the date on show, the contour before it dashed, and the linked events, with the coordinates of the current zone's centre.",
    label: "What goes in Location?",
  },
  site_coordinates: {
    text: "Decimal degrees, latitude then longitude: the centre of the site's current zone.",
    label: "What are the coordinates?",
  },
  site_details: {
    text: "Who documents the site, what kind of place it is, when its last source was captured, and the latest effect a linked event shows.",
    label: "What goes in Details?",
  },
  site_zone: {
    text: "The boundary of the site, drawn over one dated source. A contour holds from that source's capture date, and each source carries at most one. Every earlier contour stays in the site's history. Only the site's owner draws it.",
    label: "What is the contour?",
  },
  site_source: {
    text: "A dated satellite capture of the site, filed with a link that reopens it at its date. Any analyst files one, and only that analyst removes it, once it carries no contour. A source states no effect: it shows the place on one date. It is never edited, and the site's history keeps it.",
    label: "What is a site source?",
  },
  site_source_captured: {
    text: "Required. When the satellite captured the source (UTC), as the provider dates it. The zone drawn on the source holds from this date, and a reader reopens the capture at it.",
    label: "When was the source captured?",
  },
  site_source_note: {
    text: "What the source shows, in plain words, such as new sheds or a burn scar. Keep your interpretation for an event.",
    label: "What goes in the note?",
  },
  link_effect: {
    text: "What your event shows happening at the site: damage, destruction, activity such as a column leaving or a launch, or Other. Describe only what the footage or image shows; your interpretation goes in the proof.",
    label: "What is the effect?",
  },
  event_sites: {
    text: "The sites this event is linked to, each with what the event shows there. The event's owner links and unlinks sites by editing the event, and a link holds even when the event lies outside the site's zone.",
    label: "What are linked sites?",
  },
  site_linked_events: {
    text: "The published events their authors linked to this site, newest first by the date they occurred, each with what it shows at the site and where it lies against the zone valid on its date. A link holds even when the event lies outside the zone. An event's author links it, changes its effect or unlinks it by editing the event, and can also link it from here.",
    label: "What are linked events?",
  },
  basemap_auto: {
    text: "Dark or Light, following the app theme.",
    label: "What is the Auto basemap?",
    sources: VIDIT_STYLE,
  },
  basemap_dark: {
    text: "The Vidit dark style, drawn from vector tiles of OpenStreetMap data.",
    label: "What is the Dark basemap?",
    sources: VIDIT_STYLE,
  },
  basemap_light: {
    text: "The Vidit light style, drawn from vector tiles of OpenStreetMap data.",
    label: "What is the Light basemap?",
    sources: VIDIT_STYLE,
  },
  basemap_streets: {
    text: "The OpenFreeMap Liberty street style, with Natural Earth shaded relief at low zoom.",
    label: "What is the Streets basemap?",
    sources: [openFreeMap, openStreetMap, MAP_SOURCES.naturalEarth],
  },
  basemap_terrain: {
    text: "A topographic map with contour lines and hill shading.",
    label: "What is the Terrain basemap?",
    sources: [MAP_SOURCES.openTopoMap],
  },
  basemap_satellite: {
    text: "A cloud-free satellite mosaic of 2016 at 10 m per pixel, not current imagery.",
    label: "What is the Satellite 2016 basemap?",
    sources: [MAP_SOURCES.sentinel2Cloudless],
  },
  map_label_language: {
    text: "Latin: the name in Latin script. Local: the name used on the ground. Both: Latin over local.",
    label: "What is the label language?",
    sources: OPENSTREETMAP_LAYER,
  },
  map_label_density: {
    text: "Sparse names only countries and capitals below zoom 5 and adds smaller places as you zoom in. Normal draws every label the style holds.",
    label: "What is the label density?",
    sources: [openMapTiles],
  },
  map_region_borders: {
    text: "Borders of states, provinces and districts within a country.",
    label: "What are region borders?",
    sources: OPENSTREETMAP_LAYER,
  },
  map_roads: {
    text: "Roads, railways and their names.",
    label: "What does the roads layer show?",
    sources: OPENSTREETMAP_LAYER,
  },
  map_buildings: {
    text: "Building footprints, from zoom 13.",
    label: "What does the buildings layer show?",
    sources: OPENSTREETMAP_LAYER,
  },
  map_military_airports: {
    text: "Military land, airport grounds, runways and taxiways, from zoom 10.",
    label: "What does the military areas and airports layer show?",
    sources: OPENSTREETMAP_LAYER,
  },
  map_relief: {
    text: "Hills and mountains shaded from elevation data.",
    label: "What does the relief layer show?",
    sources: [MAP_SOURCES.terrainTiles],
  },
  map_disputed_borders: {
    text: "The map data, not Vidit, decides which country borders are disputed. On, those borders draw dashed; off, they draw solid like any other border.",
    label: "What are dashed disputed borders?",
    sources: OPENSTREETMAP_LAYER,
  },
  map_daily_imagery: {
    text: "True colour VIIRS imagery of the previous UTC day, about 250 m per pixel. Clouds hide the ground.",
    label: "What is the daily satellite imagery?",
    sources: [MAP_SOURCES.nasaGibs],
  },
  map_fire_detections: {
    text: "Hot spots the VIIRS sensor detected on the previous UTC day, at 375 m: fires, flares and other heat sources.",
    label: "What are fire detections?",
    sources: [MAP_SOURCES.nasaFirms, MAP_SOURCES.nasaGibs],
  },
} as const satisfies Record<string, HelpEntry>;

/** A concept key: the single argument every `<FieldHelp>` takes. */
export type Concept = keyof typeof FIELD_HELP;

/** A field's name and its `?`, as a field table holds them (`EVENT_FIELDS`, `SOURCE_FIELDS`):
 *  the read side's `DetailRow` and the edit side's `FieldLabel` both take it. */
export interface FieldName {
  label: string;
  concept?: Concept;
}
