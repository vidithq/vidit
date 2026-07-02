import type { ReactNode } from "react";

import { SectionEyebrow } from "@/components/ui/SectionEyebrow";

// The "Proof" section: the `SectionEyebrow` + the bordered box that wraps a
// geolocation's or a bounty's proof body. Both detail pages rendered the same
// eyebrow + box recipe by hand; the shell lives here once, the caller passes the
// proof body (which differs: a geolocation's rendered doc, a bounty's
// in-progress notes).
export function ProofSection({ children }: { children: ReactNode }) {
  return (
    <div>
      <SectionEyebrow title="Proof" concept="section_proof" />
      <div className="bg-neutral-900 rounded-lg p-4 border border-neutral-700">
        {children}
      </div>
    </div>
  );
}
