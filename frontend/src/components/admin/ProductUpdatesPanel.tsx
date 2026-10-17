"use client";

import { useState } from "react";

import {
  PRODUCT_UPDATES_PATH,
  previewProductUpdate,
  sendProductUpdate,
  sendTestProductUpdate,
  type ProductUpdate,
  type ProductUpdateDraft,
  type ProductUpdateList,
  type ProductUpdatePreview,
} from "@/lib/productUpdates";
import { useApiResource } from "@/hooks/useApiResource";
import { ARM_MS, useConfirmAction } from "@/hooks/useConfirmAction";
import { useMutation } from "@/hooks/useMutation";
import { countLabel } from "@/lib/format";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import {
  FORM_ERROR_BANNER,
  FORM_LABEL,
  FORM_SUCCESS_BANNER,
} from "@/components/ui/form-styles";
import { ARMED_RING, WARNING_CALLOUT } from "@/components/ui/styles";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Textarea } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Pill";

const EMPTY: ProductUpdateDraft = { label: "", title: "", body: "", link_url: "" };

function draftBody(draft: ProductUpdateDraft): ProductUpdateDraft {
  return { ...draft, link_url: draft.link_url?.trim() ? draft.link_url.trim() : null };
}

function SentRow({ update }: { update: ProductUpdate }) {
  const { sent, queued, sending, failed, skipped } = update.progress;
  return (
    <li className="py-2 border-b border-neutral-800 last:border-0 text-xs space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="accent">{update.label}</Pill>
        <span className="text-neutral-200">{update.title}</span>
        <span className="text-neutral-500">
          {new Date(update.created_at).toLocaleDateString()}
        </span>
      </div>
      <p className="text-neutral-400 tabular-nums">
        {`${sent} of ${update.recipient_count} sent · ${queued + sending} waiting · ${skipped} skipped`}
        {failed > 0 && (
          <Pill tone="danger" className="ml-2">
            {`${failed} failed`}
          </Pill>
        )}
      </p>
    </li>
  );
}

/** Compose a major release announcement, preview it as a recipient sees it, test it on your own
 *  address, then queue it for every analyst who opted in. The worker sends it under its own
 *  daily cap, so the preview states how many days the send takes. */
export function ProductUpdatesPanel() {
  const [draft, setDraft] = useState<ProductUpdateDraft>(EMPTY);
  const [preview, setPreview] = useState<ProductUpdatePreview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const history = useApiResource<ProductUpdateList>(PRODUCT_UPDATES_PATH);

  const showPreview = useMutation(() => previewProductUpdate(draftBody(draft)), {
    fallback: "Preview failed",
    onSuccess: setPreview,
  });
  const sendTest = useMutation(() => sendTestProductUpdate(draftBody(draft)), {
    fallback: "Test email failed",
    onSuccess: () => setNotice("Test email sent to your address."),
  });
  const send = useMutation(() => sendProductUpdate(draftBody(draft)), {
    fallback: "Send failed",
    onSuccess: (sent) => {
      setNotice(`Release ${sent.label} queued for ${countLabel(sent.recipient_count, "analyst")}.`);
      setDraft(EMPTY);
      setPreview(null);
      history.refetch();
    },
  });
  const confirm = useConfirmAction(() => void send.run(), { timeoutMs: ARM_MS });

  const edit = (field: keyof ProductUpdateDraft) => (value: string) => {
    setDraft((d) => ({ ...d, [field]: value }));
    // A send always follows a preview of exactly what goes out.
    setPreview(null);
    setNotice(null);
    confirm.cancel();
  };

  const mutations = [showPreview, sendTest, send];
  const busy = mutations.some((m) => m.loading);
  const error = showPreview.error ?? sendTest.error ?? send.error;
  const complete = draft.label.trim() && draft.title.trim() && draft.body.trim();

  return (
    <Card as="section">
      <header>
        <SectionEyebrow title="Release announcement" margin="none" />
        <p className="text-xs text-neutral-500 mt-0.5">
          One email per major release (MAJOR.MINOR.0), to every analyst who opted in and holds a
          verified address. A blank line starts a paragraph; lines that start with a dash form a
          list.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-[8rem_1fr] gap-3">
        <div>
          <label htmlFor="pu-label" className={FORM_LABEL}>
            Release
          </label>
          <Input
            id="pu-label"
            value={draft.label}
            onChange={(e) => edit("label")(e.target.value)}
            placeholder="1.4.0"
            className="mt-1 font-mono"
          />
        </div>
        <div>
          <label htmlFor="pu-title" className={FORM_LABEL}>
            Title
          </label>
          <Input
            id="pu-title"
            value={draft.title}
            maxLength={120}
            onChange={(e) => edit("title")(e.target.value)}
            className="mt-1"
          />
        </div>
      </div>
      <div>
        <label htmlFor="pu-body" className={FORM_LABEL}>
          Body
        </label>
        <Textarea
          id="pu-body"
          rows={8}
          maxLength={5000}
          value={draft.body}
          onChange={(e) => edit("body")(e.target.value)}
          className="mt-1"
        />
      </div>
      <div>
        <label htmlFor="pu-link" className={FORM_LABEL}>
          Link (optional)
        </label>
        <Input
          id="pu-link"
          type="url"
          value={draft.link_url ?? ""}
          onChange={(e) => edit("link_url")(e.target.value)}
          placeholder="https://vidit.app/about"
          className="mt-1"
        />
      </div>

      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}
      {notice && <div className={FORM_SUCCESS_BANNER}>{notice}</div>}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={!complete || busy}
          onClick={() => void showPreview.run()}
        >
          {showPreview.loading ? "Rendering…" : "Preview"}
        </Button>
        <Button
          variant="secondary"
          disabled={!preview || busy}
          onClick={() => void sendTest.run()}
        >
          {sendTest.loading ? "Sending…" : "Send a test to me"}
        </Button>
      </div>

      {preview && (
        <div className="space-y-3">
          <p className="text-xs text-neutral-400">
            <span className={FORM_LABEL}>Subject</span>
            <span className="text-neutral-200">{preview.subject}</span>
          </p>
          {/* The rendered email, isolated from the console: no script, no same-origin access. */}
          <iframe
            title="Email preview"
            sandbox=""
            srcDoc={preview.html}
            className="w-full h-[28rem] rounded-md border border-neutral-700 bg-white"
          />
          <p className="text-xs text-neutral-400">
            {`${countLabel(preview.recipients, "analyst")} opted in. At ${preview.daily_cap} a day, ` +
              `${preview.batch_size} per worker pass, the send takes ` +
              `${countLabel(preview.days, "day")}.`}
          </p>
          {confirm.armed && (
            <div className={`px-3 py-2 rounded-md text-xs ${WARNING_CALLOUT}`}>
              Each release is sent once. Click &ldquo;Confirm&rdquo; to queue it.
            </div>
          )}
          <Button
            variant="primary"
            disabled={busy || preview.recipients === 0}
            onClick={confirm.trigger}
            className={confirm.armed ? ARMED_RING : ""}
          >
            {send.loading
              ? "Queueing…"
              : confirm.armed
                ? "Confirm"
                : `Send to ${countLabel(preview.recipients, "analyst")}`}
          </Button>
        </div>
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className={FORM_LABEL}>Sent</span>
          <Button variant="ghost" onClick={history.refetch}>
            Refresh
          </Button>
        </div>
        {history.error && <div className={FORM_ERROR_BANNER}>{history.error}</div>}
        {history.data && history.data.items.length === 0 && (
          <p className="text-xs text-neutral-500">No announcement sent yet.</p>
        )}
        <ul>
          {history.data?.items.map((update) => (
            <SentRow key={update.id} update={update} />
          ))}
        </ul>
      </div>
    </Card>
  );
}
