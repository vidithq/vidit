"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";

import { setEventModeration, type AdminEventModeration } from "@/lib/admin";
import { formatInstant } from "@/lib/format";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { useMutation } from "@/hooks/useMutation";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER, FORM_LABEL } from "@/components/ui/form-styles";
import { WARNING_CALLOUT } from "@/components/ui/styles";
import { Button, DANGER_CONFIRM } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { ActionReceipt } from "@/components/admin/ActionReceipt";

/**
 * The direct moderation override, by event id, with no report behind it: the
 * `PATCH /admin/events/{id}/moderation` counterpart of the report queue's
 * verdicts, and the one verb that undoes a takedown. Same input-by-id shape as
 * the delete panel, since an admin reaches both from an id they already have.
 *
 * Two independent axes: `is_graphic` overrides the author's declaration,
 * `hidden` withholds the event from every public read. Each action moves one
 * axis and leaves the other exactly as it is.
 */

// One action per button: the label plus the body it PATCHes. Hiding is the
// destructive arm, so it takes the two-click confirm.
const ACTIONS = [
  { key: "mark", label: "Mark graphic", body: { is_graphic: true } },
  { key: "unmark", label: "Unmark graphic", body: { is_graphic: false } },
  { key: "unhide", label: "Restore", body: { hidden: false } },
] as const;

export function EventModerationPanel() {
  const [id, setId] = useState("");
  const [result, setResult] = useState<AdminEventModeration | null>(null);

  const moderateMutation = useMutation(
    (body: { is_graphic?: boolean; hidden?: boolean }) =>
      setEventModeration(id.trim(), body),
    {
      fallback: "Moderation failed",
      onSuccess: (moderation) => {
        setResult(moderation);
        confirmHide.cancel();
      },
    }
  );
  const confirmHide = useConfirmAction(() => {
    void moderateMutation.run({ hidden: true });
  });

  const busy = moderateMutation.loading;
  const disabled = busy || !id.trim();

  const run = (body: { is_graphic?: boolean; hidden?: boolean }) => {
    confirmHide.cancel();
    void moderateMutation.run(body);
  };

  return (
    <Card as="section">
      <header>
        <SectionEyebrow title="Moderate an event" margin="none" />
        <p className="text-xs text-neutral-500 mt-0.5">
          Move either moderation axis straight, without a report behind it.
          Graphic blurs the media behind an age confirmation. Hidden drops the
          event from every public read (the detail page answers 404 for
          everyone but an admin); Restore is what brings it back. Audited
          either way, and a call that moves nothing writes nothing.
        </p>
      </header>

      <div>
        <label className={FORM_LABEL} htmlFor="moderation-event-id">
          Event ID (UUID)
        </label>
        <Input
          variant="compact"
          id="moderation-event-id"
          type="text"
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            confirmHide.cancel();
          }}
          placeholder="00000000-0000-0000-0000-000000000000"
          className="mt-1 font-mono"
        />
      </div>

      {moderateMutation.error && (
        <div className={FORM_ERROR_BANNER}>{moderateMutation.error}</div>
      )}

      {confirmHide.armed && (
        <div className={`px-3 py-2 rounded-md text-xs ${WARNING_CALLOUT}`}>
          The event drops off every public read until it is restored. Click
          &ldquo;Confirm&rdquo; again to proceed.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {ACTIONS.map((action) => (
          <Button
            key={action.key}
            variant="secondary"
            disabled={disabled}
            onClick={() => run(action.body)}
          >
            {action.label}
          </Button>
        ))}
        <Button
          variant="danger"
          disabled={disabled}
          className={confirmHide.armed ? DANGER_CONFIRM : ""}
          onClick={() => confirmHide.trigger()}
        >
          {confirmHide.armed ? "Confirm" : "Hide"}
        </Button>
        {confirmHide.armed && (
          <Button variant="ghost" onClick={() => confirmHide.cancel()}>
            Cancel
          </Button>
        )}
      </div>

      {result && (
        <ActionReceipt
          // `hidden_at` is the takedown, so a withheld row reads as the hard
          // mode of this panel and a live one as the soft mode.
          mode={result.hidden_at ? "hard" : "soft"}
          header={
            <>
              <MapPin size={12} className="text-orange-400" />
              <span className="font-medium">
                {result.is_graphic ? "Graphic" : "Not graphic"}
              </span>
            </>
          }
        >
          <div className="text-neutral-500 font-mono text-[11px]">{result.id}</div>
          <div className="text-neutral-500">
            {result.hidden_at
              ? `Hidden since ${formatInstant(result.hidden_at)}.`
              : "Visible on every public read."}
          </div>
        </ActionReceipt>
      )}
    </Card>
  );
}
