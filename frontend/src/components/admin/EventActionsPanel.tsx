"use client";

import { useRef, useState } from "react";
import { MapPin, X } from "lucide-react";

import {
  deleteEvent,
  setEventModeration,
  type AdminEventDeleteResponse,
  type AdminEventModeration,
} from "@/lib/admin";
import { countLabel, formatInstant } from "@/lib/format";
import { search } from "@/lib/search";
import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";
import { useMutation } from "@/hooks/useMutation";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER, FORM_LABEL } from "@/components/ui/form-styles";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Combobox } from "@/components/ui/Combobox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Pill } from "@/components/ui/Pill";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ActionReceipt } from "@/components/admin/ActionReceipt";

/**
 * Every admin action on one event, with no report behind it: the two moderation axes
 * (`PATCH /admin/events/{id}/moderation`, the one verb that undoes a takedown) and the soft or
 * hard delete (`DELETE /admin/events/{id}`). The event comes from a title search over `GET /search`
 * or a pasted ID or event link. Hide and delete open a `ConfirmDialog`.
 */

type ModerationBody = { is_graphic?: boolean; hidden?: boolean };

const MODERATION_ACTIONS = [
  { key: "mark", label: "Mark graphic", body: { is_graphic: true } },
  { key: "unmark", label: "Unmark graphic", body: { is_graphic: false } },
  { key: "unhide", label: "Restore", body: { hidden: false } },
] as const;

type Receipt =
  | { kind: "moderation"; data: AdminEventModeration }
  | { kind: "delete"; data: AdminEventDeleteResponse };

/** An event the panel acts on. A pasted ID carries no title. */
type Target = { id: string; title: string | null };
type Hit = { id: string; title: string; owner: string };

// An event ID alone or inside an event link (`/events/{id}`, `/events/{id}/v2`).
const EVENT_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_LIMIT = 10;

async function searchEvents(q: string): Promise<Hit[]> {
  const found = await search({ q, type: "event", limit: SEARCH_LIMIT });
  return [...found.geolocations, ...found.requests].map((hit) => ({
    id: hit.id,
    title: hit.title,
    owner: hit.owner.username,
  }));
}

/** The event field: a title search over the public events, or a pasted ID or event link, which
 *  the search cannot reach for a hidden event. The pick shows as a chip that removes on click. */
function EventField({
  target,
  onChange,
}: {
  target: Target | null;
  onChange: (target: Target | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  // Keyed by its query, so rows never belong to an older one. `hits` is null when the request failed.
  const [result, setResult] = useState<{ query: string; hits: Hit[] | null } | null>(null);

  const q = query.trim();
  useDebouncedEffect(
    () => {
      if (!open || !q) return;
      let cancelled = false;
      searchEvents(q).then(
        (hits) => !cancelled && setResult({ query: q, hits }),
        () => !cancelled && setResult({ query: q, hits: null }),
      );
      return () => {
        cancelled = true;
      };
    },
    [q, open],
    SEARCH_DEBOUNCE_MS,
  );

  const pick = (next: Target) => {
    onChange(next);
    setQuery("");
    setOpen(false);
  };

  if (target) {
    const name = target.title ?? target.id;
    return (
      <div>
        <Pill
          tone="accent"
          title={`Remove ${name}`}
          icon={<MapPin size={12} aria-hidden />}
          onClick={() => {
            onChange(null);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        >
          <span className={target.title ? undefined : "font-mono"}>{name}</span>
          <X size={12} aria-hidden />
        </Pill>
      </div>
    );
  }

  const current = result?.query === q ? result : null;
  const rows = current?.hits ?? [];
  const pasted = (text: string) => text.match(EVENT_ID)?.[0].toLowerCase();

  return (
    <Combobox
      inputRef={inputRef}
      id="event-actions-id"
      placeholder="Title, event ID or link"
      query={query}
      onQueryChange={(next) => {
        const id = pasted(next);
        if (id) pick({ id, title: null });
        else setQuery(next);
      }}
      open={open && q.length > 0}
      onOpenChange={setOpen}
      options={current ? rows : []}
      optionKey={(hit) => hit.id}
      renderOption={(hit) => (
        <>
          <span className="min-w-0 truncate">{hit.title}</span>{" "}
          <span className="min-w-0 truncate text-xs text-neutral-500">{hit.owner}</span>
        </>
      )}
      onPick={(hit) => pick({ id: hit.id, title: hit.title })}
      status={
        !current
          ? "Searching…"
          : current.hits === null
            ? "Could not load suggestions"
            : rows.length === 0
              ? "No public event matches. Paste the ID or link of a hidden one."
              : null
      }
    />
  );
}

export function EventActionsPanel() {
  const [target, setTarget] = useState<Target | null>(null);
  const [mode, setMode] = useState<"soft" | "hard">("soft");
  const [confirming, setConfirming] = useState<"hide" | "delete" | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const id = target?.id ?? "";

  const moderateMutation = useMutation(
    (body: ModerationBody) => setEventModeration(id, body),
    {
      fallback: "Moderation failed",
      onSuccess: (data) => {
        setReceipt({ kind: "moderation", data });
        setConfirming(null);
      },
    }
  );
  const deleteMutation = useMutation(
    () => deleteEvent(id, { hard: mode === "hard" }),
    {
      fallback: "Delete failed",
      onSuccess: (data) => {
        setReceipt({ kind: "delete", data });
        setConfirming(null);
        setTarget(null);
        setMode("soft");
      },
    }
  );

  const moderate = (body: ModerationBody) => {
    deleteMutation.reset();
    void moderateMutation.run(body);
  };

  const confirm = (kind: "hide" | "delete") => {
    moderateMutation.reset();
    deleteMutation.reset();
    setConfirming(kind);
  };

  const busy = moderateMutation.loading || deleteMutation.loading;
  const disabled = busy || !target;
  const error = moderateMutation.error ?? deleteMutation.error;
  const deleteLabel = mode === "hard" ? "Hard delete" : "Soft delete";
  const name = target?.title ?? "this event";

  return (
    <Card as="section">
      <header>
        <SectionEyebrow title="Manage an event" margin="none" />
        <p className="text-xs text-neutral-500 mt-0.5">
          Act on one event, with no report behind it. Graphic blurs the media
          behind an age confirmation. Hide withholds the event from every
          public read, and Restore undoes a hide. Soft delete removes the event
          from public view and keeps its proof and S3 evidence. Hard delete
          erases the row, its media rows and its S3 objects (the GDPR path).
          Every action is audited.
        </p>
      </header>

      <div className="space-y-1">
        <label className={FORM_LABEL} htmlFor="event-actions-id">
          Event (title, ID or link)
        </label>
        <EventField
          target={target}
          onChange={(next) => {
            setTarget(next);
            moderateMutation.reset();
            deleteMutation.reset();
          }}
        />
      </div>

      {error && !confirming && <div className={FORM_ERROR_BANNER}>{error}</div>}

      <div className="space-y-2">
        <span className={FORM_LABEL}>Moderation</span>
        <div className="flex flex-wrap gap-2">
          {MODERATION_ACTIONS.map((action) => (
            <Button
              key={action.key}
              variant="secondary"
              disabled={disabled}
              onClick={() => moderate(action.body)}
            >
              {action.label}
            </Button>
          ))}
          <Button variant="danger" disabled={disabled} onClick={() => confirm("hide")}>
            Hide
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <span className={FORM_LABEL}>Delete</span>
        <SegmentedControl
          aria-label="Delete mode"
          fullWidth
          options={[
            { value: "soft", label: "Soft delete (default)" },
            { value: "hard", label: "Hard delete (GDPR)", tone: "danger" },
          ]}
          value={mode}
          onChange={setMode}
        />
        <div className="flex gap-2">
          <Button variant="danger" disabled={disabled} onClick={() => confirm("delete")}>
            {deleteLabel}
          </Button>
        </div>
      </div>

      {confirming === "hide" && (
        <ConfirmDialog
          title={`Hide ${name}?`}
          confirmLabel="Hide"
          busyLabel="Hiding…"
          busy={busy}
          error={moderateMutation.error}
          onConfirm={() => moderate({ hidden: true })}
          onCancel={() => setConfirming(null)}
        >
          <p>The event drops off every public read until it is restored.</p>
        </ConfirmDialog>
      )}

      {confirming === "delete" && (
        <ConfirmDialog
          title={`${deleteLabel} ${name}?`}
          confirmLabel={deleteLabel}
          busyLabel="Deleting…"
          busy={busy}
          error={deleteMutation.error}
          onConfirm={() => {
            moderateMutation.reset();
            void deleteMutation.run();
          }}
          onCancel={() => setConfirming(null)}
        >
          {mode === "hard" ? (
            <p>
              <strong>Hard delete is irreversible.</strong> The row, its media,
              and its S3 objects are erased.
            </p>
          ) : (
            <p>The event is removed from public view. Its proof and S3 evidence stay.</p>
          )}
        </ConfirmDialog>
      )}

      {receipt?.kind === "moderation" && (
        <ActionReceipt
          // `hidden_at` is the takedown: a withheld row reads as hard, a live one as soft.
          mode={receipt.data.hidden_at ? "hard" : "soft"}
          header={
            <>
              <MapPin size={12} className="text-orange-400" />
              <span className="font-medium">
                {receipt.data.is_graphic ? "Graphic" : "Not graphic"}
              </span>
            </>
          }
        >
          <div className="text-neutral-500 font-mono text-[11px]">
            {receipt.data.id}
          </div>
          <div className="text-neutral-500">
            {receipt.data.hidden_at
              ? `Hidden since ${formatInstant(receipt.data.hidden_at)}.`
              : "Visible on every public read."}
          </div>
        </ActionReceipt>
      )}

      {receipt?.kind === "delete" && (
        <ActionReceipt
          mode={receipt.data.mode}
          header={
            <>
              <MapPin size={12} className="text-orange-400" />
              <span className="font-medium">{receipt.data.title}</span>
            </>
          }
        >
          <div className="text-neutral-500 font-mono text-[11px]">
            {receipt.data.geolocation_id}
          </div>
          {receipt.data.mode === "hard" && (
            <div className="text-neutral-500">
              Swept {countLabel(receipt.data.media_count, "media row")} (source and proof roles).
            </div>
          )}
        </ActionReceipt>
      )}
    </Card>
  );
}
