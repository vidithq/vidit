"use client";

import { Textarea } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { CharCounter } from "@/components/ui/CharCounter";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BIO_MAX_LEN, type ProfileEditState } from "./useProfileEdit";

/** The bio as an editable field: textarea plus remaining-characters counter against
 * `BIO_MAX_LEN`, nothing in view mode (reading it is one line of the identity block,
 * `ProfileIdentity`). */
export function BioField({ edit }: { edit: ProfileEditState }) {
  if (!edit.editing) return null;

  return (
    <Card as="section">
      <div className="flex items-center justify-between gap-2">
        <SectionHeading title="Bio" />
        <CharCounter length={edit.draftBio.length} max={BIO_MAX_LEN} />
      </div>
      <Textarea
        aria-label="Bio"
        value={edit.draftBio}
        invalid={edit.bioOver}
        onChange={(e) => edit.setDraftBio(e.target.value)}
        placeholder="A short blurb about you, your focus area, what to expect from your submissions."
        className="min-h-[96px] resize-y"
      />
    </Card>
  );
}
