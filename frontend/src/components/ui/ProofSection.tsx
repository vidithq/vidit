import type { ReactNode } from "react";

import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";

// The "Proof" section: the `SectionEyebrow` + the bordered box that wraps a
// geolocation's or a bounty's proof body. Both detail pages rendered the same
// eyebrow + box recipe by hand; the shell lives here once, the caller passes
// the proof body (which differs: a geolocation's rendered doc, a bounty's
// in-progress notes). The box is the shared <Card> one density step tighter
// (p-4): proof is a reading surface, not a form.
export function ProofSection({ children }: { children: ReactNode }) {
  return (
    <div>
      <SectionEyebrow title="Proof" concept="section_proof" />
      <Card className="p-4">{children}</Card>
    </div>
  );
}
