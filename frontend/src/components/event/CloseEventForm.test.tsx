import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";

import { CloseEventForm } from "./CloseEventForm";
import { closeEvent } from "@/lib/events";
import type { EventDetail } from "@/types";

vi.mock("@/lib/events", () => ({
  closeEvent: vi.fn(),
}));

const mockClose = closeEvent as unknown as Mock;

beforeEach(() => {
  mockClose.mockReset();
});

describe("CloseEventForm", () => {
  it("names the row it closes: a request", () => {
    render(
      <CloseEventForm
        eventId="e1"
        status="requested"
        onClosed={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText("Close reason")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Close this request" })
    ).toBeInTheDocument();
  });

  it("names the row it closes: a detection", () => {
    render(
      <CloseEventForm
        eventId="e1"
        status="detected"
        onClosed={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText("Close reason")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Close this detection" })
    ).toBeInTheDocument();
  });

  it("requires a non-empty reason before calling the API", () => {
    render(
      <CloseEventForm
        eventId="e1"
        status="requested"
        onClosed={() => {}}
        onCancel={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Close this request" }));
    expect(mockClose).not.toHaveBeenCalled();
    expect(
      screen.getByText("A reason is required to close this request.")
    ).toBeInTheDocument();
  });

  it("sends the trimmed reason and reports the closed row", async () => {
    const closed = { id: "e1", status: "closed" } as EventDetail;
    mockClose.mockResolvedValue(closed);
    const onClosed = vi.fn();
    render(
      <CloseEventForm
        eventId="e1"
        status="detected"
        onClosed={onClosed}
        onCancel={() => {}}
      />
    );
    fireEvent.change(screen.getByLabelText("Close reason"), {
      target: { value: "  AI-generated image  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close this detection" }));
    await waitFor(() =>
      expect(mockClose).toHaveBeenCalledWith("e1", "AI-generated image")
    );
    await waitFor(() => expect(onClosed).toHaveBeenCalledWith(closed));
  });

  it("cancel dismisses without closing", () => {
    const onCancel = vi.fn();
    render(
      <CloseEventForm
        eventId="e1"
        status="requested"
        onClosed={() => {}}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
  });
});
