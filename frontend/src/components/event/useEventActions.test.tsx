import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";

import { useEventActions } from "./useEventActions";
import { useReportEvent } from "./useReportEvent";
import { investigateEvent, reportEvent, uninvestigateEvent } from "@/lib/events";
import type { EventDetail } from "@/types";

vi.mock("@/lib/events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events")>()),
  investigateEvent: vi.fn(),
  uninvestigateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  reportEvent: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const ME = { id: "u1", username: "me" };

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: ME }),
}));

const mockInvestigate = investigateEvent as unknown as Mock;
const mockUninvestigate = uninvestigateEvent as unknown as Mock;
const mockReport = reportEvent as unknown as Mock;

beforeEach(() => {
  mockInvestigate.mockReset();
  mockUninvestigate.mockReset();
  mockReport.mockReset();
});

/** An open request owned by somebody else, so the Investigate action shows. */
function makeRequest(investigators: { id: string }[] = []): EventDetail {
  return {
    id: "e1",
    status: "requested",
    owner: { id: "u2", username: "author" },
    investigators,
  } as unknown as EventDetail;
}

function ActionsHarness({ event }: { event: EventDetail | null }) {
  const { actions, panels } = useEventActions({
    event,
    surface: "request",
    // The real page passes `refetch`, which is fire-and-forget: it does not
    // hand back fresh data, the parent re-renders with it later. A test drives
    // that by re-rendering with a new `event`.
    onChanged: () => {},
  });
  return (
    <>
      {actions}
      {panels}
    </>
  );
}

const INVESTIGATE = "Investigate";
const INVESTIGATING = "Investigating";

describe("useEventActions investigate state", () => {
  it("releases the optimistic override once the toggle succeeds", async () => {
    mockInvestigate.mockResolvedValue(undefined);
    const { rerender } = render(<ActionsHarness event={makeRequest()} />);

    fireEvent.click(screen.getByRole("button", { name: INVESTIGATE }));
    // Optimistic: the label flips before any server round trip.
    expect(
      screen.getByRole("button", { name: INVESTIGATING })
    ).toBeInTheDocument();
    await waitFor(() => expect(mockInvestigate).toHaveBeenCalledWith("e1"));

    // The parent's refetch lands: the server now agrees, and the button holds.
    rerender(<ActionsHarness event={makeRequest([ME])} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: INVESTIGATING })
      ).toBeInTheDocument()
    );

    // The real assertion: the override is gone, so the button follows the
    // server again rather than staying pinned to the optimistic value. Both
    // endpoints resolve `void`, so the old `if (ok !== undefined)` release
    // never fired and this rendered "Investigating" forever.
    rerender(<ActionsHarness event={makeRequest()} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: INVESTIGATE })
      ).toBeInTheDocument()
    );
  });

  it("rolls the optimistic flip back when the toggle fails", async () => {
    mockInvestigate.mockRejectedValue(new Error("nope"));
    render(<ActionsHarness event={makeRequest()} />);

    fireEvent.click(screen.getByRole("button", { name: INVESTIGATE }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: INVESTIGATE })
      ).toBeInTheDocument()
    );
  });

  it("drops the optimistic state when the row changes under the hook", async () => {
    mockInvestigate.mockResolvedValue(undefined);
    const { rerender } = render(<ActionsHarness event={makeRequest()} />);

    fireEvent.click(screen.getByRole("button", { name: INVESTIGATE }));
    expect(
      screen.getByRole("button", { name: INVESTIGATING })
    ).toBeInTheDocument();

    // A client navigation to another request keeps this hook mounted. The next
    // row must not inherit the previous one's optimistic flag.
    const other = { ...makeRequest(), id: "e2" } as EventDetail;
    rerender(<ActionsHarness event={other} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: INVESTIGATE })
      ).toBeInTheDocument()
    );
  });
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
