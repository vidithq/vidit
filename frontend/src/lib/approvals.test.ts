import { describe, expect, it } from "vitest";

import { changesSince, standingApprovalBefore, type Approval } from "./approvals";
import { eventDetail, filedVersion } from "@/test/eventDetail";

const live = {
  ...eventDetail("e1", "Strike on the depot"),
  version_no: 3,
  archived_source: { url: "https://web.archive.org/web/2026/x", provider: "wayback" as const },
};

describe("changesSince", () => {
  it("names the fields that moved since the approved version", () => {
    const approved = filedVersion(live, 1, {
      title: "Strike near the depot",
      event_coords: { lat: 49.7, lng: 37.6 },
    });
    expect(changesSince(live, approved)).toEqual(["Title", "Coordinates", "Archived copies"]);
  });

  it("reads an archive-only change as archived copies alone", () => {
    expect(changesSince(live, filedVersion(live, 2))).toEqual(["Archived copies"]);
  });

  it("cannot compare a redacted version", () => {
    expect(changesSince(live, { ...filedVersion(live, 1), redacted: true, snapshot: {} })).toBeNull();
  });
});

describe("standingApprovalBefore", () => {
  const approval = (version_no: number, revoked_at: string | null = null) =>
    ({ version_no, revoked_at }) as Approval;

  it("picks the latest earlier version still standing", () => {
    expect(standingApprovalBefore([approval(1), approval(2, "2026-10-15"), approval(3)], 4)).toBe(3);
    expect(standingApprovalBefore([approval(4)], 4)).toBeNull();
    expect(standingApprovalBefore([approval(2, "2026-10-15")], 4)).toBeNull();
  });
});
