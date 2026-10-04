import type { ReactNode } from "react";

import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";

// The "Proof" section: `SectionEyebrow` plus a box wrapping a geolocation's or
// request's proof body (the caller passes the body). The box is `<Card>` one
// density step tighter (p-4): proof is a reading surface.
export function ProofSection({ children }: { children: ReactNode }) {
  return (
    <div>
      <SectionEyebrow title="Proof" concept="section_proof" />
      <Card className="p-4">{children}</Card>
    </div>
  );
}
