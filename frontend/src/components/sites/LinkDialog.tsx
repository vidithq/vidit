"use client";

import { useState, type ReactNode } from "react";
import { Link2, Search } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { Input } from "@/components/ui/Input";
import { MediaOverlay } from "@/components/ui/MediaLightbox";
import { Pill } from "@/components/ui/Pill";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { FORM_ERROR_BANNER, FORM_LABEL } from "@/components/ui/form-styles";
import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";
import { useMutation } from "@/hooks/useMutation";
import { LINK_EFFECT_LABELS, labelOptions, type LinkEffect } from "@/lib/sites";

const SEARCH_DEBOUNCE_MS = 250;

/** One pickable row of the dialog: a site to link the event to, or an event to link to the site. */
export interface LinkCandidate {
  id: string;
  label: string;
  /** What the reader needs to choose: the type, the owner, the distance. */
  meta: string;
}

/**
 * The one dialog behind both directions of a link: an event owner picking a site from the event
 * page, or picking one of their events from a site page. Suggestions and search results are
 * chips; the pick and the effect go out together.
 */
export function LinkDialog({
  title,
  subtitle,
  suggestedLabel,
  emptySuggestions,
  suggestions,
  searchPlaceholder,
  search,
  initial,
  onLink,
  onClose,
}: {
  title: string;
  subtitle: ReactNode;
  suggestedLabel: string;
  emptySuggestions: string;
  /** Null while the suggestions load. */
  suggestions: LinkCandidate[] | null;
  searchPlaceholder: string;
  search: (q: string, signal: AbortSignal) => Promise<LinkCandidate[]>;
  /** The live link being edited, to change its effect. */
  initial?: { candidate: LinkCandidate; effect: LinkEffect };
  onLink: (id: string, effect: LinkEffect) => Promise<unknown>;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<LinkCandidate | null>(initial?.candidate ?? null);
  const [effect, setEffect] = useState<LinkEffect>(initial?.effect ?? "damage");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LinkCandidate[] | null>(null);
  const link = useMutation(() => onLink(picked!.id, effect), {
    fallback: "Failed to link",
    onSuccess: onClose,
  });

  useDebouncedEffect(
    () => {
      const q = query.trim();
      if (!q) {
        setResults(null);
        return;
      }
      const controller = new AbortController();
      search(q, controller.signal)
        .then(setResults)
        .catch(() => {});
      return () => controller.abort();
    },
    [query],
    SEARCH_DEBOUNCE_MS,
  );

  const chips = (rows: LinkCandidate[]) => (
    <div className="flex flex-wrap gap-1.5">
      {rows.map((row) => (
        <Pill
          key={row.id}
          tone={picked?.id === row.id ? "accent" : "neutral"}
          onClick={() => setPicked(row)}
          title={row.meta}
        >
          {row.label}
        </Pill>
      ))}
    </div>
  );

  return (
    <MediaOverlay variant="dialog" label={title} onClose={onClose}>
      <Card className="w-[min(36rem,calc(100vw-3rem))]">
        <div className="space-y-1">
          <h2 className="text-base font-medium text-neutral-100">{title}</h2>
          <p className="text-sm text-neutral-400">{subtitle}</p>
        </div>

        <div className="space-y-2">
          <span className={FORM_LABEL}>{suggestedLabel}</span>
          {suggestions === null ? (
            <p className="text-sm text-neutral-500">Loading…</p>
          ) : suggestions.length === 0 ? (
            <p className="text-sm text-neutral-500">{emptySuggestions}</p>
          ) : (
            chips(suggestions)
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="link-search" className={FORM_LABEL}>
            Or search by name
          </label>
          <Input
            id="link-search"
            icon={<Search size={14} />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
          />
          {results !== null &&
            (results.length === 0 ? (
              <p className="text-sm text-neutral-500">No match.</p>
            ) : (
              chips(results)
            ))}
        </div>

        {picked && (
          <p className="text-sm text-neutral-300">
            {picked.label} <span className="text-neutral-500">· {picked.meta}</span>
          </p>
        )}

        <div className="space-y-2">
          <span className="flex items-center gap-1">
            <span className={FORM_LABEL}>Effect on the site</span>
            <FieldHelp concept="link_effect" size={12} />
          </span>
          <SegmentedControl
            aria-label="Effect on the site"
            options={labelOptions(LINK_EFFECT_LABELS)}
            value={effect}
            onChange={setEffect}
          />
          <p className="text-xs text-neutral-500">
            Describe only what the footage or image shows. Your interpretation goes in the proof.
          </p>
        </div>

        {link.error && <div className={FORM_ERROR_BANNER}>{link.error}</div>}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" data-overlay-close="" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!picked || link.loading} onClick={() => void link.run()}>
            <Link2 size={14} />
            {link.loading ? "Linking…" : "Link"}
          </Button>
        </div>
      </Card>
    </MediaOverlay>
  );
}
