"use client";

import { useState, type ReactNode } from "react";
import { X } from "lucide-react";

import { Combobox } from "@/components/ui/Combobox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { Pill } from "@/components/ui/Pill";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { META_LINE } from "@/components/ui/styles";
import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";
import { useMutation } from "@/hooks/useMutation";
import { LINK_EFFECTS, LINK_EFFECT_LABELS, type LinkEffect } from "@/lib/sites";

const SEARCH_DEBOUNCE_MS = 250;

const EFFECT_OPTIONS = LINK_EFFECTS.map((value) => ({ value, label: LINK_EFFECT_LABELS[value] }));

/** One pickable row of the dialog: a site to link the event to, or an event to link to the site. */
export interface LinkCandidate {
  id: string;
  label: string;
  /** What the reader needs to choose: the kind, the date, the distance. */
  meta: string;
}

/** The suggestions a dialog offers before any search. */
interface LinkSuggestions {
  label: string;
  /** Null while they load. */
  rows: LinkCandidate[] | null;
  empty: string;
}

/** The dialog's words when it changes a live link's effect, from either page. */
export const CHANGE_EFFECT_COPY = {
  title: "Change the effect",
  intro: "The link keeps its history: the site's page records the effect it had and the new one.",
};

/**
 * The one dialog behind both directions of a link, on `ConfirmDialog`: an event's owner picks a
 * site from the event page, or one of their events from a site page. The suggestions, when the
 * caller has some (the sites near the event), show as chips, any other pick comes from the search, and the pick shows as an accent chip a
 * click removes. The effect has no default: the analyst says what the event shows. `extra`
 * renders under the effect once a pick is made (the offer to file the event's satellite images).
 */
export function LinkDialog({
  title,
  intro,
  pickLabel,
  suggestions,
  searchLabel,
  searchPlaceholder,
  search,
  initial,
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
  /** A live link whose effect the dialog changes: the pick is fixed. */
  initial?: { candidate: LinkCandidate; effect: LinkEffect };
  extra?: (picked: LinkCandidate) => ReactNode;
  onLink: (picked: LinkCandidate, effect: LinkEffect) => Promise<unknown>;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<LinkCandidate | null>(initial?.candidate ?? null);
  const [effect, setEffect] = useState<LinkEffect | "">(initial?.effect ?? "");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ query: string; rows: LinkCandidate[] | null } | null>(null);
  const link = useMutation(() => onLink(picked!, effect as LinkEffect), {
    fallback: "The link failed. Try again.",
    onSuccess: onClose,
  });

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

  const pick = (candidate: LinkCandidate) => {
    setPicked(candidate);
    setQuery("");
    setOpen(false);
  };
  const changing = initial !== undefined;
  const unchanged = changing && effect === initial.effect;

  return (
    <ConfirmDialog
      title={title}
      confirmLabel={changing ? "Save the effect" : "Link"}
      busyLabel="Saving…"
      busy={link.loading}
      confirmDisabled={!picked || !effect || unchanged}
      error={link.error}
      onConfirm={() => void link.run()}
      onCancel={onClose}
    >
      <p>{intro}</p>

      <div className="space-y-2 pt-1">
        <FieldLabel label={pickLabel} />
        {picked ? (
          <div className="space-y-1">
            {changing ? (
              <Pill tone="accent">{picked.label}</Pill>
            ) : (
              <Pill tone="accent" title={`Remove ${picked.label}`} onClick={() => setPicked(null)}>
                {picked.label}
                <X size={12} aria-hidden />
              </Pill>
            )}
            <p className={META_LINE}>{picked.meta}</p>
          </div>
        ) : (
          <>
            {suggestions && (
              <>
                <p className="text-xs text-neutral-500">{suggestions.label}</p>
                {suggestions.rows === null ? (
                  <p className="text-xs text-neutral-500">Loading…</p>
                ) : suggestions.rows.length === 0 ? (
                  <p className="text-xs text-neutral-500">{suggestions.empty}</p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5" aria-label={suggestions.label}>
                    {suggestions.rows.map((s) => (
                      <li key={s.id} className="max-w-full">
                        <Pill tone="neutral" title={s.meta} onClick={() => pick(s)}>
                          {s.label}
                          <span className="font-normal opacity-70">{s.meta}</span>
                        </Pill>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            <Combobox
              aria-label={searchLabel}
              placeholder={searchPlaceholder}
              options={rows}
              optionKey={(row) => row.id}
              renderOption={(row) => (
                <span className="min-w-0">
                  <span className="block truncate">{row.label}</span>
                  <span className="block truncate text-xs text-neutral-500">{row.meta}</span>
                </span>
              )}
              onPick={pick}
              query={query}
              onQueryChange={setQuery}
              open={open && q !== ""}
              onOpenChange={setOpen}
              status={status}
            />
          </>
        )}
      </div>

      <div className="space-y-2 pt-1">
        <FieldLabel label="What the event shows at the site" concept="link_effect" />
        <SegmentedControl<LinkEffect | "">
          aria-label="Effect on the site"
          options={EFFECT_OPTIONS}
          value={effect}
          onChange={setEffect}
          fullWidth
        />
      </div>

      {picked && extra?.(picked)}
    </ConfirmDialog>
  );
}
