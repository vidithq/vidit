"use client";

import { useState } from "react";

import { idIn, setCollectionModeration, type AdminCollectionModeration } from "@/lib/admin";
import { CollectionIcon } from "@/lib/collections";
import { formatInstant } from "@/lib/format";
import { useMutation } from "@/hooks/useMutation";
import { ActionReceipt } from "@/components/admin/ActionReceipt";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/Input";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_LABEL } from "@/components/ui/form-styles";

/**
 * Hide or restore one collection with no report behind it
 * (`PATCH /admin/collections/{id}/moderation`), the one verb that puts a withheld collection
 * back. The collection is named by a pasted ID or link, since a withheld one is out of search.
 */
export function CollectionModerationPanel() {
  const [text, setText] = useState("");
  const [receipt, setReceipt] = useState<AdminCollectionModeration | null>(null);
  const id = idIn(text);

  const moderate = useMutation((hidden: boolean) => setCollectionModeration(id ?? "", hidden), {
    fallback: "Moderation failed",
    onSuccess: setReceipt,
  });
  const disabled = moderate.loading || id === null;

  return (
    <Card as="section">
      <header>
        <SectionEyebrow title="Moderate a collection" margin="none" />
        <p className="text-xs text-neutral-500 mt-0.5">
          Hide withholds a collection from every read but an admin&apos;s, its owner included.
          Restore puts it back. The events on it stay as they are.
        </p>
      </header>

      <div className="space-y-1">
        <label className={FORM_LABEL} htmlFor="collection-moderation-id">
          Collection (ID or link)
        </label>
        <Input
          variant="compact"
          id="collection-moderation-id"
          placeholder="Collection ID or link"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            moderate.reset();
          }}
        />
      </div>

      {moderate.error && <ErrorNotice error={moderate.error} />}

      <div className="flex flex-wrap gap-2">
        <Button
          action="show"
          variant="secondary"
          disabled={disabled}
          onClick={() => void moderate.run(false)}
        >
          Restore
        </Button>
        <ConfirmButton
          action="hide"
          label="Hide"
          disabled={disabled}
          onConfirm={() => moderate.run(true)}
        />
      </div>

      {receipt && (
        <ActionReceipt
          action={receipt.hidden_at ? "Hidden" : "Restored"}
          danger={receipt.hidden_at !== null}
          header={
            <>
              <CollectionIcon size={12} className="text-orange-400" />
              <span className="font-medium">{receipt.title}</span>
            </>
          }
        >
          <div className="text-neutral-500">
            {receipt.hidden_at
              ? `Hidden since ${formatInstant(receipt.hidden_at)}.`
              : "Visible on every public read."}
          </div>
        </ActionReceipt>
      )}
    </Card>
  );
}
