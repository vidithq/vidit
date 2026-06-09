"use client";

import { seedDemo, wipeDemo } from "@/lib/admin";
import { SeedWipePanel } from "./SeedWipePanel";

export function DemoDataPanel() {
  return (
    <SeedWipePanel
      title="Demo data"
      description={
        <>
          Generate synthetic geolocations from the curated{" "}
          <code className="text-neutral-400">demo-pool/</code> S3 prefix.
          Demo authors and rows are flagged{" "}
          <code className="text-neutral-400">is_demo</code>; wipe drops every
          flagged row in one go (the pool itself stays).
        </>
      }
      countInputId="seed-count"
      defaultCount={100}
      maxCount={50000}
      seed={seedDemo}
      seedLabel="Generate demo data"
      wipe={wipeDemo}
      wipeLabel="Wipe all demo data"
      renderSeedSummary={(last) => (
        <>
          Last seeded: {last.created} geos across{" "}
          {last.templates} template{last.templates === 1 ? "" : "s"}.
        </>
      )}
      renderWipeSummary={(last) => (
        <>
          Last wiped: {last.deleted_geos} geos,{" "}
          {last.deleted_users} demo users.
        </>
      )}
    />
  );
}
