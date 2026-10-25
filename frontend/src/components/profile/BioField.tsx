"use client";

import { Textarea } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { CharCounter } from "@/components/ui/CharCounter";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BIO_MAX_LEN, type ProfileEditState } from "./useProfileEdit";

const PLACEHOLDER = {
  analyst: "A short blurb about you, your focus area, what to expect from your submissions.",
  organization: "A short blurb about the organization: who it is, what it covers, how it works.",
} as const;

/** The bio as an editable field: textarea plus characters counter against `BIO_MAX_LEN`, nothing
 * in view mode (reading it is one line of the identity block, `ProfileIdentity`). `owner` words
 * the placeholder for an analyst or an organization. */
export function BioField({
  edit,
  owner = "analyst",
}: {
  edit: ProfileEditState;
  owner?: keyof typeof PLACEHOLDER;
}) {
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
        placeholder={PLACEHOLDER[owner]}
        className="min-h-[96px] resize-y"
      />
    </Card>
  );
}
