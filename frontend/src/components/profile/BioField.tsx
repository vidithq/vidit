"use client";

import { Textarea } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { BIO_MAX_LEN, type ProfileEditState } from "./useProfileEdit";

/**
 * The bio as an editable field: textarea plus remaining-characters counter,
 * and nothing at all in view mode.
 *
 * Reading the bio is not a section of the page. It is one line of the identity
 * block under the handle (`ProfileIdentity`), which is what keeps the top of a
 * profile compact and puts the analyst's work above their framing of it.
 * Writing it still needs a labelled field with a counter against
 * `BIO_MAX_LEN`, so edit mode gives it a card, next to the linked-accounts
 * inputs it is saved with.
 */
export function BioField({ edit }: { edit: ProfileEditState }) {
  if (!edit.editing) return null;

  return (
    <Card>
      <div className="flex items-center justify-between">
        <SectionEyebrow title="Bio" margin="none" />
        <span
          className={`text-[11px] ${
            edit.bioOver ? "text-red-400" : "text-neutral-500"
          }`}
        >
          {edit.bioRemaining} / {BIO_MAX_LEN}
        </span>
      </div>
      <Textarea
        value={edit.draftBio}
        onChange={(e) => edit.setDraftBio(e.target.value)}
        placeholder="A short blurb about you, your focus area, what to expect from your submissions."
        className="min-h-[96px] resize-y"
      />
    </Card>
  );
}
