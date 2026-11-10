import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useReportContent } from "./useReportContent";
import { apiFetch } from "@/test/apiStub";
import { pickOption } from "@/test/options";
import type { ReportTargetKind } from "@/lib/reports";

vi.mock("@/lib/api", () => import("@/test/apiStub"));

vi.mock("next/navigation", () => import("@/test/navigationStub"));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", username: "me" } }),
}));

function ReportHarness({
  eventId,
  kind = "event",
}: {
  eventId: string;
  kind?: ReportTargetKind;
}) {
  const { trigger, panel } = useReportContent(kind, eventId);
  return (
    <>
      {trigger}
      {panel}
    </>
  );
}

describe("useReportContent state per target", () => {
  it("opens the report as a dialog, Cancel first", () => {
    render(<ReportHarness eventId="e1" />);
    const trigger = screen.getByRole("button", { name: "Report" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Report this event" });
    expect(dialog).toContainElement(screen.getByLabelText("Reason"));
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    // Each label explains itself through the shared `?`, not an "(optional)" marker.
    expect(screen.getByRole("button", { name: "Which reason fits?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What goes in the details?" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("resets an open, half-filled form when the event changes", () => {
    const { rerender } = render(<ReportHarness eventId="e1" />);
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    pickOption("Reason", "Copyright");
    fireEvent.change(screen.getByLabelText("Details"), {
      target: { value: "half a sentence" },
    });

    rerender(<ReportHarness eventId="e2" />);

    // Closed, and nothing of the previous event's draft survives.
    expect(screen.queryByLabelText("Details")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    expect(screen.getByLabelText("Details")).toHaveValue("");
    expect(screen.getByText("Illegal content")).toBeInTheDocument();
  });

  it("does not carry one event's receipt onto the next", async () => {
    apiFetch.mockResolvedValue(undefined);
    const { rerender } = render(<ReportHarness eventId="e1" />);
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Report received")
    );
    // The receipt replaces the trigger for the event just reported.
    expect(screen.queryByRole("button", { name: "Report" })).toBeNull();

    rerender(<ReportHarness eventId="e2" />);

    // A different event was never reported, so its flag is back.
    expect(screen.queryByRole("status")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Report" })
    ).toBeInTheDocument();
  });
});

describe("useReportContent per kind", () => {
  it.each([
    ["event", "/events/x1/report"],
    ["collection", "/collections/x1/report"],
    ["site", "/sites/x1/report"],
  ] as const)("sends a %s report to its endpoint", async (kind, path) => {
    apiFetch.mockResolvedValue(undefined);
    render(<ReportHarness kind={kind} eventId="x1" />);

    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    // The form names what it is about, so a reader knows what they are flagging.
    expect(screen.getByText(`Report this ${kind}`)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Details"), {
      target: { value: "  not what it says  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(path, {
        method: "POST",
        body: JSON.stringify({ reason: "illegal_content", details: "not what it says" }),
      })
    );
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
