import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";

import { useReportContent } from "./useReportContent";
import { reportCollection } from "@/lib/collections";
import { reportEvent } from "@/lib/events";

vi.mock("@/lib/events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events")>()),
  reportEvent: vi.fn(),
}));

vi.mock("@/lib/collections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collections")>()),
  reportCollection: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", username: "me" } }),
}));

const mockReport = reportEvent as unknown as Mock;
const mockReportCollection = reportCollection as unknown as Mock;

beforeEach(() => {
  mockReport.mockReset();
  mockReportCollection.mockReset();
});

function ReportHarness({
  eventId,
  kind = "event",
}: {
  eventId: string;
  kind?: "event" | "collection";
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
  it("ties aria-controls to the form only while it is open", () => {
    render(<ReportHarness eventId="e1" />);
    const trigger = screen.getByRole("button", { name: "Report" });
    expect(trigger).not.toHaveAttribute("aria-controls");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-controls", "report-content-form");
  });

  it("resets an open, half-filled form when the event changes", () => {
    const { rerender } = render(<ReportHarness eventId="e1" />);
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "copyright" },
    });
    fireEvent.change(screen.getByLabelText("Details (optional)"), {
      target: { value: "half a sentence" },
    });

    rerender(<ReportHarness eventId="e2" />);

    // Closed, and nothing of the previous event's draft survives.
    expect(screen.queryByLabelText("Details (optional)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    expect(screen.getByLabelText("Details (optional)")).toHaveValue("");
    expect(screen.getByLabelText("Reason")).toHaveValue("illegal_content");
  });

  it("does not carry one event's receipt onto the next", async () => {
    mockReport.mockResolvedValue(undefined);
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
  it("sends a collection report to the collection endpoint", async () => {
    mockReportCollection.mockResolvedValue(undefined);
    render(<ReportHarness kind="collection" eventId="c1" />);

    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    // The form names what it is about, so a reader knows what they are
    // flagging.
    expect(screen.getByText("Report this collection")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Details (optional)"), {
      target: { value: "  not what it says  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));

    await waitFor(() =>
      expect(mockReportCollection).toHaveBeenCalledWith("c1", {
        reason: "illegal_content",
        details: "not what it says",
      })
    );
    // One target per report: the event endpoint is never touched.
    expect(mockReport).not.toHaveBeenCalled();
  });
});
