import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";

import { useReportEvent } from "./useReportEvent";
import { reportEvent } from "@/lib/events";

vi.mock("@/lib/events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events")>()),
  reportEvent: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", username: "me" } }),
}));

const mockReport = reportEvent as unknown as Mock;

beforeEach(() => {
  mockReport.mockReset();
});

function ReportHarness({ eventId }: { eventId: string }) {
  const { trigger, panel } = useReportEvent(eventId);
  return (
    <>
      {trigger}
      {panel}
    </>
  );
}

describe("useReportEvent state per event", () => {
  it("ties aria-controls to the form only while it is open", () => {
    render(<ReportHarness eventId="e1" />);
    const trigger = screen.getByRole("button", { name: "Report" });
    expect(trigger).not.toHaveAttribute("aria-controls");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-controls", "report-event-form");
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
