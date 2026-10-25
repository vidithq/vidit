import { describe, expect, it } from "vitest";

import { approvalBefore, changesSince, type Approval } from "./approvals";
import { eventDetail, filedVersion } from "@/test/eventDetail";

const base = eventDetail("e1", "Strike on the depot");
const live = {
  ...base,
  version_no: 3,
  sources: [
    {
      ...base.sources[0],
      links: base.sources[0].links.map((l) => ({
        ...l,
        archived: {
          url: "https://web.archive.org/web/2026/x",
          provider: "wayback" as const,
          archived_at: "2026-06-01T00:00:00Z",
        },
      })),
    },
  ],
};
// The live row before its link was archived.
const unarchived = { ...live, sources: base.sources };

describe("changesSince", () => {
  it("names the fields that moved since the approved version", () => {
    const approved = filedVersion(unarchived, 1, {
      title: "Strike near the depot",
      coords: { lat: 49.7, lng: 37.6 },
    });
    expect(changesSince(live, approved)).toEqual(["Title", "Coordinates", "Archived copies"]);
  });

  it("reads an archive-only change as archived copies alone", () => {
    expect(changesSince(live, filedVersion(unarchived, 2))).toEqual(["Archived copies"]);
  });

  it("cannot compare a redacted version", () => {
    expect(changesSince(live, { ...filedVersion(live, 1), redacted: true, snapshot: {} })).toBeNull();
  });
});

describe("approvalBefore", () => {
  const approval = (version_no: number) => ({ version_no }) as Approval;

  it("picks the latest earlier version approved", () => {
    expect(approvalBefore([approval(1), approval(3)], 4)).toBe(3);
    expect(approvalBefore([approval(4)], 4)).toBeNull();
    expect(approvalBefore([], 4)).toBeNull();
  });
});
