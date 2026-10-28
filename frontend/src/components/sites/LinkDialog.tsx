"use client";

import { useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";

import { Combobox } from "@/components/ui/Combobox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { LoadMoreRow } from "@/components/ui/LoadMoreRow";
import { Pill } from "@/components/ui/Pill";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { META_LINE } from "@/components/ui/styles";
import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";
import { useMutation } from "@/hooks/useMutation";
import {
  LINK_EFFECTS,
  LINK_EFFECT_LABELS,
  SITE_KIND_LABELS,
  formatDistance,
  type LinkEffect,
  type SiteSuggestion,
} from "@/lib/sites";

const SEARCH_DEBOUNCE_MS = 250;

/** How many suggestions show before **Show more**. */
const SUGGESTIONS_SHOWN = 4;

const EFFECT_OPTIONS = LINK_EFFECTS.map((value) => ({ value, label: LINK_EFFECT_LABELS[value] }));

/** One pickable row of a link picker: a site to link the event to, or an event to link to the
 *  site. */
export interface LinkCandidate {
  id: string;
  label: string;
  /** What the reader needs to choose: the kind, the date, the distance. */
  meta: string;
}

/** The suggestions a picker offers before any search. */
export interface LinkSuggestions {
  label: string;
  /** Null while they load. */
  rows: LinkCandidate[] | null;
}

/** A site as the pickers list it: its name, then its kind and how far it lies from the event. */
export function siteCandidate(s: SiteSuggestion): LinkCandidate {
  const where =
    s.distance_m === null
      ? null
      : s.distance_m === 0
        ? "event inside the zone"
        : `${formatDistance(s.distance_m)} from the event`;
  return { id: s.id, label: s.name, meta: [SITE_KIND_LABELS[s.kind], where].filter(Boolean).join(" · ") };
}

/** The suggestions of a link picker as neutral chips, the first few, then one **Show more**.
 *  Nothing renders when there is none: the search follows. */
export function LinkSuggestionPills({
  suggestions,
  onPick,
}: {
  suggestions: LinkSuggestions;
  onPick: (picked: LinkCandidate) => void;
}) {
  const [all, setAll] = useState(false);
  const { label, rows } = suggestions;
  if (rows?.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs text-neutral-500">{label}</p>
      {rows === null ? (
        <p className="text-xs text-neutral-500">Loading…</p>
      ) : (
        <>
          <ul className="flex flex-wrap gap-1.5" aria-label={label}>
            {(all ? rows : rows.slice(0, SUGGESTIONS_SHOWN)).map((s) => (
              <li key={s.id} className="max-w-full">
                <Pill tone="neutral" title={s.meta} onClick={() => onPick(s)}>
                  <Plus size={12} aria-hidden />
                  {s.label}
                  <span className="font-normal opacity-70">{s.meta}</span>
                </Pill>
              </li>
            ))}
          </ul>
          <LoadMoreRow
            walk={{
              hasMore: !all && rows.length > SUGGESTIONS_SHOWN,
              loadingMore: false,
              loadMore: () => setAll(true),
              error: null,
            }}
          />
        </>
      )}
    </div>
  );
}

/** The heading of a name search's rows, apart from the suggestions' own. */
const SEARCH_RESULTS = "Search results";

/** The name search of a link picker, on `Combobox`: `search` runs once typing rests, and a pick
 *  empties the field. Its rows sit under their own heading, since a site found by name may lie
 *  past the suggestions' distance. */
export function LinkSearch({
  label,
  placeholder,
  search,
  onPick,
}: {
  label: string;
  placeholder: string;
  search: (q: string, signal: AbortSignal) => Promise<LinkCandidate[]>;
  onPick: (picked: LinkCandidate) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ query: string; rows: LinkCandidate[] | null } | null>(null);

  const q = query.trim();
  useDebouncedEffect(
    () => {
      if (!q) return;
      const controller = new AbortController();
      search(q, controller.signal)
        .then((rows) => setResult({ query: q, rows }))
        .catch(() => {
          if (!controller.signal.aborted) setResult({ query: q, rows: null });
        });
      return () => controller.abort();
    },
    [q],
    SEARCH_DEBOUNCE_MS,
  );
  const current = result?.query === q ? result : null;
  const rows = q && current?.rows ? current.rows : [];
  const status = !q
    ? null
    : !current
      ? "Searching…"
      : current.rows === null
        ? "The search failed."
        : current.rows.length === 0
          ? "No match."
          : null;

  return (
    <Combobox
      aria-label={label}
      placeholder={placeholder}
      options={rows}
      optionKey={(row) => row.id}
      renderOption={(row) => (
        <span className="min-w-0">
          <span className="block truncate">{row.label}</span>
          <span className="block truncate text-xs text-neutral-500">{row.meta}</span>
        </span>
      )}
      onPick={(row) => {
        onPick(row);
        setQuery("");
        setOpen(false);
      }}
      query={query}
      onQueryChange={setQuery}
      open={open && q !== ""}
      onOpenChange={setOpen}
      status={status}
      heading={SEARCH_RESULTS}
    />
  );
}

/** The effect of one link, unpicked until the analyst says what the event shows. `fullWidth`
 *  shares the width out equally; off, each option keeps its label's width from `sm` up, for a
 *  column narrower than the dialog. */
export function EffectControl({
  value,
  onChange,
  fullWidth = true,
  "aria-label": ariaLabel,
}: {
  value: LinkEffect | "";
  onChange: (effect: LinkEffect) => void;
  fullWidth?: boolean;
  "aria-label": string;
}) {
  return (
    <SegmentedControl<LinkEffect | "">
      aria-label={ariaLabel}
      options={EFFECT_OPTIONS}
      value={value}
      onChange={(next) => {
        if (next) onChange(next);
      }}
      fullWidth={fullWidth}
    />
  );
}

/**
 * The dialog of the pages' link actions, on `ConfirmDialog`: an event's owner picks a site from
 * the event page, or one of their events from a site page. The suggestions, when the caller has
 * some (the sites near the event), show as chips, any other pick comes from the search, and the
 * pick shows as an accent chip a click removes. The effect has no default: the analyst says what
 * the event shows. `extra` renders under the effect once a pick is made (the offer to file the
 * event's satellite sources).
 */
export function LinkDialog({
  title,
  intro,
  pickLabel,
  suggestions,
  searchLabel,
  searchPlaceholder,
  search,
  extra,
  onLink,
  onClose,
}: {
  title: string;
  intro: ReactNode;
  /** The pick's name: Site, Event. */
  pickLabel: string;
  suggestions?: LinkSuggestions;
  searchLabel: string;
  searchPlaceholder: string;
  search: (q: string, signal: AbortSignal) => Promise<LinkCandidate[]>;
  extra?: (picked: LinkCandidate) => ReactNode;
  onLink: (picked: LinkCandidate, effect: LinkEffect) => Promise<unknown>;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<LinkCandidate | null>(null);
  const [effect, setEffect] = useState<LinkEffect | "">("");
  const link = useMutation(() => onLink(picked!, effect as LinkEffect), {
    fallback: "The link failed. Try again.",
    onSuccess: onClose,
  });

  return (
    <ConfirmDialog
      title={title}
      confirmLabel="Link"
      confirmAction="link"
      busyLabel="Saving…"
      busy={link.loading}
      confirmDisabled={!picked || !effect}
      error={link.error}
      onConfirm={() => void link.run()}
      onCancel={onClose}
    >
      <p>{intro}</p>

      <div className="space-y-2 pt-1">
        <FieldLabel label={pickLabel} />
        {picked ? (
          <div className="space-y-1">
            <Pill tone="accent" title={`Remove ${picked.label}`} onClick={() => setPicked(null)}>
              {picked.label}
              <X size={12} aria-hidden />
            </Pill>
            <p className={META_LINE}>{picked.meta}</p>
          </div>
        ) : (
          <>
            {suggestions && <LinkSuggestionPills suggestions={suggestions} onPick={setPicked} />}
            <LinkSearch
              label={searchLabel}
              placeholder={searchPlaceholder}
              search={search}
              onPick={setPicked}
            />
          </>
        )}
      </div>

      <div className="space-y-2 pt-1">
        <FieldLabel label="What the event shows at the site" concept="link_effect" />
        <EffectControl aria-label="Effect on the site" value={effect} onChange={setEffect} />
      </div>

      {picked && extra?.(picked)}
    </ConfirmDialog>
  );
}
