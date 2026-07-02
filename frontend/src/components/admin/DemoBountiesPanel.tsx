"use client";

import { seedDemoBounties, wipeDemoBounties } from "@/lib/admin";
import { SeedWipePanel } from "./SeedWipePanel";

export function DemoBountiesPanel() {
  return (
    <SeedWipePanel
      title="Demo bounties"
      description={
        <>
          Generate synthetic bounties from the same{" "}
          <code className="text-neutral-400">demo-pool/</code> imagery the
          geolocation seeder uses. Authors are the existing demo pool;
          rows are flagged <code className="text-neutral-400">is_demo</code>{" "}
          and spread across the lifecycle (most open, a few fulfilled into a
          geolocation, a few closed) so the status-filter chips and the
          &ldquo;Requested by&rdquo; trace on a fulfilled event all exercise. A
          fraction of open bounties get random claims
          attached so the &ldquo;N working&rdquo; badge has something to
          render. Wipe drops every flagged bounty (demo users and demo
          geos stay).
        </>
      }
      countInputId="seed-bounty-count"
      defaultCount={20}
      maxCount={5000}
      seed={seedDemoBounties}
      seedLabel="Generate demo bounties"
      wipe={wipeDemoBounties}
      wipeLabel="Wipe all demo bounties"
      renderSeedSummary={(last) => (
        <>
          Last seeded: {last.created} bounties across{" "}
          {last.templates} template
          {last.templates === 1 ? "" : "s"} · {last.open} open,{" "}
          {last.fulfilled} fulfilled, {last.closed} closed ·{" "}
          {last.with_claims} with claims.
        </>
      )}
      renderWipeSummary={(last) => (
        <>Last wiped: {last.deleted_bounties} demo bounties.</>
      )}
    />
  );
}
