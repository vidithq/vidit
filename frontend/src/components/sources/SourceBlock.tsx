import { CoordinateActions } from "@/components/event/CoordinateActions";
import { ArchivedCopies, linkDescription } from "@/components/ui/ArchivedCopies";
import { MediaGallery } from "@/components/ui/MediaGallery";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SourceLabel } from "@/components/ui/SourceLabel";
import { LIST_TILE } from "@/components/ui/form-styles";
import { cn } from "@/lib/cn";
import { formatCoordinates } from "@/lib/coordinates";
import { formatInstant, safeHostname } from "@/lib/format";
import { LEVEL_LABELS, SENSOR_LABELS, shownSensor, type Source } from "@/lib/sources";

/**
 * One source of an event on a reading surface: its title and level, its sensor, the capture
 * time and camera position when known, its file (behind its own graphic gate when this source
 * is flagged), each link with its post time and archived copy, and its tags.
 *
 * `compact` is the map panel's density: stacked `thumbnail` media and smaller text.
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
  const sensor = shownSensor(source.sensor);
  const text = compact ? "text-xs" : "text-sm";
  const camera = source.camera_position;
  return (
    <section aria-label={`Source ${index + 1}`} className={cn(LIST_TILE, "space-y-3")}>
      <header className="flex flex-wrap items-center gap-1.5">
        <h3 className={cn(text, "font-medium text-neutral-200 [overflow-wrap:anywhere]")}>
          {source.title || `Source ${index + 1}`}
        </h3>
        <Pill tone="neutral">{LEVEL_LABELS[source.level]}</Pill>
        {/* A source without a file names no sensor. */}
        {source.media && sensor && (
          <Pill tone="neutral" label="Sensor">
            {SENSOR_LABELS[sensor]}
          </Pill>
        )}
      </header>

      {source.media && (
        <MediaGallery
          media={[source.media]}
          alt={alt}
          variant={compact ? "panel" : "page"}
          isGraphic={source.is_graphic}
        />
      )}

      {(source.captured_at || camera) && (
        <dl className={cn(text, "space-y-1")}>
          {source.captured_at && (
            <div className="flex justify-between gap-x-4">
              <dt className="text-neutral-500">Captured</dt>
              <dd className="text-neutral-200">{formatInstant(source.captured_at)}</dd>
            </div>
          )}
          {camera && (
            <div className="flex items-center justify-between gap-x-4">
              <dt className="text-neutral-500">Camera position</dt>
              <dd className="flex min-w-0 items-center gap-1 text-neutral-200">
                <span className="font-mono text-xs">{formatCoordinates(camera.lat, camera.lng)}</span>
                <CoordinateActions lat={camera.lat} lng={camera.lng} />
              </dd>
            </div>
          )}
        </dl>
      )}

      {source.links.length > 0 && (
        <ul className={cn(text, "space-y-1")} aria-label={`Links of source ${index + 1}`}>
          {source.links.map((link, i) => (
            <li key={link.url} className="flex min-w-0 items-baseline justify-between gap-x-4">
              <span className="flex min-w-0 items-baseline">
                <SourceLabel url={link.url} variant="link" />
                <ArchivedCopies
                  copy={link.archived}
                  describes={linkDescription(index, safeHostname(link.url), i, source.links.length)}
                />
              </span>
              {link.posted_at && (
                <span className="shrink-0 text-[11px] text-neutral-500">
                  Posted {formatInstant(link.posted_at)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {source.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {source.tags.map((tag) => (
            <Pill key={tag.id} tone="neutral">
              {tag.name}
            </Pill>
          ))}
        </div>
      )}
    </section>
  );
}

/** An event's sources under a **Sources** eyebrow, in the order the API serves them. */
export function SourceBlocks({
  sources,
  alt,
  compact = false,
}: {
  sources: Source[];
  alt: string;
  compact?: boolean;
}) {
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
        sources.map((source, index) => (
          <SourceBlock
            key={source.id}
            source={source}
            index={index}
            alt={alt}
            compact={compact}
          />
        ))
      )}
    </div>
  );
}
