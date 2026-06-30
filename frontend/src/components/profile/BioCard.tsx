"use client";

import type { PublicProfile } from "@/lib/users";
import { FORM_INPUT } from "@/components/ui/form-styles";
import { Card } from "@/components/ui/Card";
import { BIO_MAX_LEN, type ProfileEditState } from "./useProfileEdit";

/** Bio card: textarea + remaining-characters counter in edit mode,
 *  plain text in view mode, nothing when the profile has no bio. */
export function BioCard({
  profile,
  edit,
}: {
  profile: PublicProfile;
  edit: ProfileEditState;
}) {
  if (edit.editing) {
    return (
      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-neutral-300">Bio</h2>
          <span
            className={`text-[11px] ${
              edit.bioOver ? "text-red-400" : "text-neutral-500"
            }`}
          >
            {edit.bioRemaining} / {BIO_MAX_LEN}
          </span>
        </div>
        <textarea
          value={edit.draftBio}
          onChange={(e) => edit.setDraftBio(e.target.value)}
          placeholder="A short blurb about you, your focus area, what to expect from your submissions."
          className={`${FORM_INPUT} min-h-[96px] resize-y`}
        />
      </Card>
    );
  }

  if (!profile.bio) return null;

  return (
    <Card>
      <h2 className="text-sm font-medium text-neutral-300">Bio</h2>
      <p className="text-sm text-neutral-200 whitespace-pre-line">
        {profile.bio}
      </p>
    </Card>
  );
}
