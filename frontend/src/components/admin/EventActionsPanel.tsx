"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";

import {
  deleteEvent,
  setEventModeration,
  type AdminEventDeleteResponse,
  type AdminEventModeration,
} from "@/lib/admin";
import { countLabel, formatDate, formatInstant, formatInstantDate } from "@/lib/format";
import { hitsOf, search } from "@/lib/search";
import { useMutation } from "@/hooks/useMutation";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_LABEL } from "@/components/ui/form-styles";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import type { ItemData } from "@/components/ui/Item";
import { ItemSearch } from "@/components/ui/ItemSearch";
import { eventItem } from "@/lib/items";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ActionReceipt } from "@/components/admin/ActionReceipt";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

/**
 * Every admin action on one event, with no report behind it: the two moderation axes
 * (`PATCH /admin/events/{id}/moderation`, the one verb that undoes a takedown) and the soft or
 * hard delete (`DELETE /admin/events/{id}`). The event comes from a title search over `GET /search`
 * or a pasted ID or event link. Hide and delete confirm in place.
 */

type ModerationBody = { is_graphic?: boolean; hidden?: boolean };

// `done` names the action on its receipt.
const MODERATION_ACTIONS = [
  {
    key: "mark",
    label: "Mark graphic",
    done: "Marked graphic",
    action: "graphic",
    body: { is_graphic: true },
  },
  {
    key: "unmark",
    label: "Unmark graphic",
    done: "Unmarked graphic",
    action: "graphic",
    body: { is_graphic: false },
  },
  {
    key: "unhide",
    label: "Restore",
    done: "Restored",
    action: "show",
    body: { hidden: false },
  },
] as const;
const HIDE_DONE = "Hidden";

type Receipt =
  | { kind: "moderation"; action: string; title: string | null; data: AdminEventModeration }
  | { kind: "delete"; data: AdminEventDeleteResponse };

/** An event the panel acts on. A pasted ID carries no title, and its item shows the ID. */
type Target = { id: string; title: string | null; item: ItemData };

// An event ID alone or inside an event link (`/events/{id}`, `/events/{id}/v2`).
const EVENT_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SEARCH_LIMIT = 10;

async function searchEvents(q: string): Promise<Target[]> {
  const found = await search({ q, types: ["event"], limit: SEARCH_LIMIT });
  return hitsOf(found.hits, "event").map((e) => {
    const date =
      e.status === "requested"
        ? `Requested ${formatInstantDate(e.created_at)}`
        : e.occurred_date
          ? formatDate(e.occurred_date)
          : "Undated";
    return { id: e.id, title: e.title, item: { ...eventItem({ ...e, media: e.media[0] }), date } };
  });
}

function pastedEvent(text: string): Target | null {
  const id = text.match(EVENT_ID)?.[0].toLowerCase();
  return id ? { id, title: null, item: { kind: "event", title: id } } : null;
}

export function EventActionsPanel() {
  const [target, setTarget] = useState<Target | null>(null);
  const [mode, setMode] = useState<"soft" | "hard">("soft");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const id = target?.id ?? "";

  const moderateMutation = useMutation(
    (move: { body: ModerationBody; done: string }) => setEventModeration(id, move.body),
    {
      fallback: "Moderation failed",
      onSuccess: (data, move) => {
        setReceipt({ kind: "moderation", action: move.done, title: target?.title ?? null, data });
      },
    }
  );
  const deleteMutation = useMutation(
    () => deleteEvent(id, { hard: mode === "hard" }),
    {
      fallback: "Delete failed",
      onSuccess: (data) => {
        setReceipt({ kind: "delete", data });
        setTarget(null);
        setMode("soft");
      },
    }
  );

  const retarget = (next: Target | null) => {
    setTarget(next);
    moderateMutation.reset();
    deleteMutation.reset();
  };

  const moderate = (body: ModerationBody, done: string) => {
    deleteMutation.reset();
    void moderateMutation.run({ body, done });
  };

  const busy = moderateMutation.loading || deleteMutation.loading;
  const disabled = busy || !target;
  const error = moderateMutation.error ?? deleteMutation.error;
  const deleteLabel = mode === "hard" ? "Hard delete" : "Soft delete";

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
        <ItemSearch
          id="event-actions-id"
          placeholder="Title, event ID or link"
          search={searchEvents}
          pasteId={pastedEvent}
          toItem={(t) => t.item}
          rowKey={(t) => t.id}
          selected={target}
          onPick={retarget}
          onClear={() => retarget(null)}
          emptyText="No public event matches. Paste the ID or link of a hidden one."
        />
      </div>

      {error && <ErrorNotice error={error} />}

      <div className="space-y-2">
        <span className={FORM_LABEL}>Moderation</span>
        <div className="flex flex-wrap gap-2">
          {MODERATION_ACTIONS.map((action) => (
            <Button
              action={action.action}
              key={action.key}
              variant="secondary"
              disabled={disabled}
              onClick={() => moderate(action.body, action.done)}
            >
              {action.label}
            </Button>
          ))}
          <ConfirmButton
            action="hide"
            label="Hide"
            disabled={disabled}
            onConfirm={() => moderate({ hidden: true }, HIDE_DONE)}
          />
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
          <ConfirmButton
            key={mode}
            label={deleteLabel}
            disabled={disabled}
            onConfirm={() => {
              moderateMutation.reset();
              return deleteMutation.run();
            }}
          />
        </div>
      </div>

      {receipt?.kind === "moderation" && (
        <ActionReceipt
          action={receipt.action}
          danger={receipt.action === HIDE_DONE}
          header={
            <>
              <MapPin size={12} className="text-orange-400" />
              <span className="font-medium">{receipt.title ?? receipt.data.id}</span>
            </>
          }
        >
          {receipt.title && (
            <div className="text-neutral-500 font-mono text-[11px]">{receipt.data.id}</div>
          )}
          <div className="text-neutral-500">
            {receipt.data.is_graphic ? "Graphic. " : "Not graphic. "}
            {receipt.data.hidden_at
              ? `Hidden since ${formatInstant(receipt.data.hidden_at)}.`
              : "Visible on every public read."}
          </div>
        </ActionReceipt>
      )}

      {receipt?.kind === "delete" && (
        <ActionReceipt
          action={receipt.data.mode === "hard" ? "Hard delete" : "Soft delete"}
          danger={receipt.data.mode === "hard"}
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
