import { CoordinateValue } from "@/components/event/CoordinateActions";
import { EVENT_SECTIONS } from "@/components/event/EventLayout";
import { ArchivedCopies, linkDescription } from "@/components/ui/ArchivedCopies";
import { DetailCard, DetailPills, DetailRow } from "@/components/ui/DetailRow";
import { MediaGallery } from "@/components/ui/MediaGallery";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SourceLabel } from "@/components/ui/SourceLabel";
import { LIST_TILE } from "@/components/ui/form-styles";
import { META_LINE } from "@/components/ui/styles";
import { cn } from "@/lib/cn";
import { formatInstant, formatInstantOrDate, safeHostname } from "@/lib/format";
import {
  isEvidenceLevel,
  LEVEL_LABELS,
  SOURCE_FIELDS,
  sourceKindLabel,
  sourceName,
  type Source,
} from "@/lib/sources";

import { SourcesRow } from "./SourcesRow";
import { SourceWarnings } from "./SourceWarnings";

/**
 * One source of an event on a reading surface, read like the event's Details card: its file
 * (behind its own graphic gate when this source is flagged) or a *No file* box, then one row
 * each for the title, level, kind (with the file's kind), links, capture time, capture position
 * and tags, the order of the editor's fields. A row with no value drops out. A context source
 * without a file has no file area at all: a URL alone (an article, a statement) is no gap. A
 * satellite or aircraft source's warnings follow the links.
 *
 * `compact` is the map panel's density: `thumbnail` media and bare rows in a `LIST_TILE`.
 * `wide` is for a block that owns the whole sources area: the file grows and sits left of the
 * rows once the card is wide enough.
 */
export function SourceBlock({
  source,
  index,
  alt,
  compact = false,
  wide = false,
}: {
  source: Source;
  /** Position in the event's source order, for the names ("Source 2"). */
  index: number;
  /** Alt text for an image file (the event title). */
  alt: string;
  compact?: boolean;
  wide?: boolean;
}) {
  const name = sourceName(index);
  const file = source.media === null && !isEvidenceLevel(source.level) ? null : (
    <MediaGallery
      media={source.media ? [source.media] : []}
      alt={alt}
      variant={compact ? "panel" : "page"}
      isGraphic={source.is_graphic}
      grow={wide}
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
    <DetailCard label={name} lead={file} leadBeside={wide}>
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
  const kind = sourceKindLabel(source);
  const position = source.capture_position;
  const links = source.links;
  return (
    <>
      {source.title && <DetailRow {...SOURCE_FIELDS.title} value={source.title} compact={compact} />}
      <DetailRow {...SOURCE_FIELDS.level} compact={compact} align="center">
        <Pill tone="neutral">{LEVEL_LABELS[source.level]}</Pill>
      </DetailRow>
      {kind && <DetailRow {...SOURCE_FIELDS.kind} compact={compact} value={kind} />}
      {links.length > 0 && (
        <DetailRow
          {...SOURCE_FIELDS.links}
          label={`${SOURCE_FIELDS.links.label} (${links.length})`}
          compact={compact}
          align="start"
        >
          <ul className="space-y-1.5 text-right" aria-label={`Links of ${sourceName(index).toLowerCase()}`}>
            {links.map((link, i) => (
              <li key={link.url}>
                <div className="flex items-center justify-end">
                  <SourceLabel url={link.url} variant="link" className="text-sm" />
                  <ArchivedCopies
                    copy={link.archived}
                    describes={linkDescription(index, safeHostname(link.url), i, links.length)}
                  />
                </div>
                <p className={META_LINE}>
                  {link.posted_at ? `Posted ${formatInstantOrDate(link.posted_at)}` : "Date unknown"}
                </p>
              </li>
            ))}
          </ul>
        </DetailRow>
      )}
      <SourceWarnings warnings={source.warnings} label={`Warnings of ${sourceName(index).toLowerCase()}`} />
      {source.captured_at && (
        <DetailRow
          {...SOURCE_FIELDS.captured_at}
          compact={compact}
          value={formatInstant(source.captured_at)}
        />
      )}
      {position && (
        <DetailRow
          {...SOURCE_FIELDS.capture_position}
          compact={compact}
          align="center"
          wrapLabel
        >
          <CoordinateValue lat={position.lat} lng={position.lng} compact />
        </DetailRow>
      )}
      {source.tags.length > 0 && (
        <DetailRow {...SOURCE_FIELDS.tags} compact={compact} align="start">
          <DetailPills items={source.tags} compact={compact} />
        </DetailRow>
      )}
    </>
  );
}

/**
 * An event's sources in the order the API serves them: a `SourcesRow` on the page, a lone source
 * taking the whole row as a `wide` block; a vertical stack under a **Sources** eyebrow in the map
 * panel.
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
    <SourceBlock
      key={source.id}
      source={source}
      index={index}
      alt={alt}
      compact={compact}
      wide={!compact && sources.length === 1}
    />
  ));
  const empty = <p className="text-sm text-neutral-500 italic">No source yet</p>;
  if (!compact) {
    return <SourcesRow count={sources.length}>{sources.length === 0 ? empty : blocks}</SourcesRow>;
  }
  const { title, concept } = EVENT_SECTIONS.sources;
  return (
    <div className="space-y-2">
      <SectionEyebrow as="h3" margin="none" title={title} concept={concept} />
      {sources.length === 0 ? empty : blocks}
    </div>
  );
}
