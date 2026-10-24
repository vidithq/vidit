import { CoordinateValue } from "@/components/event/CoordinateActions";
import { ArchivedCopies, linkDescription } from "@/components/ui/ArchivedCopies";
import { DetailCard, DetailPills, DetailRow } from "@/components/ui/DetailRow";
import { HorizontalScroller } from "@/components/ui/HorizontalScroller";
import { MediaGallery } from "@/components/ui/MediaGallery";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SourceLabel } from "@/components/ui/SourceLabel";
import { LIST_TILE } from "@/components/ui/form-styles";
import { META_LINE } from "@/components/ui/styles";
import { cn } from "@/lib/cn";
import { formatInstant, formatInstantDate, safeHostname } from "@/lib/format";
import { LEVEL_LABELS, SENSOR_LABELS, shownSensor, type Source } from "@/lib/sources";

/**
 * One source of an event on a reading surface, read like the event's Details card: its file
 * (behind its own graphic gate when this source is flagged) or a *No file* box, then one row
 * each for the title, level, sensor, sensor position, capture time, links and tags. A row with
 * no value drops out, except the title, which reads *Untitled*.
 *
 * `compact` is the map panel's density: `thumbnail` media and bare rows in a `LIST_TILE`.
 */
export function SourceBlock({
  source,
  index,
  alt,
  compact = false,
}: {
  source: Source;
  /** Position in the event's source order, for the names ("Source 2"). */
  index: number;
  /** Alt text for an image file (the event title). */
  alt: string;
  compact?: boolean;
}) {
  const name = `Source ${index + 1}`;
  const file = (
    <MediaGallery
      media={source.media ? [source.media] : []}
      alt={alt}
      variant={compact ? "panel" : "page"}
      isGraphic={source.is_graphic}
      empty="No file"
    />
  );
  const rows = <SourceRows source={source} index={index} compact={compact} />;
  if (compact) {
    return (
      <section aria-label={name} className={cn(LIST_TILE, "space-y-2 text-sm")}>
        {file}
        {rows}
      </section>
    );
  }
  return (
    <DetailCard label={name} lead={file}>
      {rows}
    </DetailCard>
  );
}

function SourceRows({
  source,
  index,
  compact,
}: {
  source: Source;
  index: number;
  compact: boolean;
}) {
  // A source without a file names no sensor.
  const sensor = source.media ? shownSensor(source.sensor) : null;
  const position = source.sensor_position;
  const links = source.links;
  return (
    <>
      <DetailRow label="Title" value={source.title} empty="Untitled" compact={compact} />
      <DetailRow label="Level" concept="source_level" compact={compact} align="center">
        <Pill tone="neutral">{LEVEL_LABELS[source.level]}</Pill>
      </DetailRow>
      {sensor && (
        <DetailRow
          label="Sensor"
          concept="sensor"
          compact={compact}
          value={SENSOR_LABELS[sensor]}
        />
      )}
      {position && (
        <DetailRow
          label="Sensor position"
          concept="sensor_position"
          compact={compact}
          align="center"
          wrapLabel
        >
          <CoordinateValue lat={position.lat} lng={position.lng} compact />
        </DetailRow>
      )}
      {source.captured_at && (
        <DetailRow
          label="Captured"
          concept="captured_at"
          compact={compact}
          value={formatInstant(source.captured_at)}
        />
      )}
      {links.length > 0 && (
        <DetailRow
          label={`Links (${links.length})`}
          concept="source_links"
          compact={compact}
          align="start"
        >
          <ul className="space-y-1.5 text-right" aria-label={`Links of source ${index + 1}`}>
            {links.map((link, i) => (
              <li key={link.url}>
                <div className="flex items-center justify-end">
                  <SourceLabel url={link.url} variant="link" withPath className="text-sm" />
                  <ArchivedCopies
                    copy={link.archived}
                    describes={linkDescription(index, safeHostname(link.url), i, links.length)}
                  />
                </div>
                <p className={META_LINE}>
                  {link.posted_at ? `Posted ${formatInstantDate(link.posted_at)}` : "Date unknown"}
                </p>
              </li>
            ))}
          </ul>
        </DetailRow>
      )}
      {source.tags.length > 0 && (
        <DetailRow label="Tags" compact={compact} align="start">
          <DetailPills items={source.tags} compact={compact} />
        </DetailRow>
      )}
    </>
  );
}

/**
 * An event's sources under a **Sources** eyebrow, in the order the API serves them: a vertical
 * stack in the map panel, a `<HorizontalScroller>` row on the page.
 */
export function SourceBlocks({
  sources,
  alt,
  compact = false,
}: {
  sources: Source[];
  alt: string;
  compact?: boolean;
}) {
  const blocks = sources.map((source, index) => (
    <SourceBlock key={source.id} source={source} index={index} alt={alt} compact={compact} />
  ));
  if (!compact && sources.length > 0) {
    return (
      <HorizontalScroller
        heading={
          <SectionEyebrow margin="none" title={`Sources (${sources.length})`} concept="sources" />
        }
        label="Sources"
        previousLabel="Previous source"
        nextLabel="Next source"
      >
        {blocks}
      </HorizontalScroller>
    );
  }
  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <SectionEyebrow
        as={compact ? "h3" : undefined}
        margin="none"
        title="Sources"
        concept="sources"
      />
      {sources.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">No source yet</p>
      ) : (
        blocks
      )}
    </div>
  );
}
