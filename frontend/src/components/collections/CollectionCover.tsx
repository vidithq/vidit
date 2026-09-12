import { MediaThumb } from "@/components/ui/EntityCard";

/**
 * A collection's cover, in the two shapes the product shows it: the card's
 * 16:9 slot on the profile grid, and the band over the collection page's own
 * header.
 *
 * It is the catalogue card's media slot (`MediaThumb`), so a cover and an event
 * thumbnail are the same box and a collection with nothing to show falls back
 * to the one "no media" placeholder the site already draws rather than to a
 * second stand-in of its own. The picture is decorative: the title names the
 * collection right beside it, and on a card the stretched link is already
 * labelled with that title.
 *
 * The band takes the embedded surface treatment the page's map below it takes
 * (a `rounded-lg` box on a `neutral-700` border), at a band height rather than
 * a hero: shorter on a phone, where the header plus a full-height cover would
 * push the title itself under the fold.
 */
export function CollectionCover({
  coverUrl,
  variant = "card",
}: {
  coverUrl: string | null;
  /** `card`: the profile grid's 16:9 slot. `band`: the page header's strip. */
  variant?: "card" | "band";
}) {
  return (
    <MediaThumb
      src={coverUrl ?? undefined}
      className={
        variant === "band"
          ? "w-full aspect-auto h-30 sm:h-40 rounded-lg border border-neutral-700"
          : "w-full"
      }
    />
  );
}
