import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { eventDetail } from "@/test/eventDetail";
import type { EventDetail } from "@/types";
import { EventShare } from "./EventShare";

const geolocated: EventDetail = eventDetail("e1", "Strike near Bakhmut");
const URL_OF_E1 = `${window.location.origin}/events/e1`;

function withWebShare() {
  const share = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "share", { value: share, configurable: true });
  return share;
}

function withClipboard() {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
}

/** Which mark the button shows: the check while the copy flash holds, the share mark otherwise. */
function visibleMark(button: HTMLElement): "check" | "share" {
  const [rest, check] = button.querySelectorAll(":scope > span > span");
  expect(rest.className.includes("opacity-0")).not.toBe(check.className.includes("opacity-0"));
  return check.className.includes("opacity-100") ? "check" : "share";
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (navigator as { share?: unknown }).share;
});

describe("EventShare without the Web Share API", () => {
  it("copies the event's address in one click, with no menu", async () => {
    const writeText = withClipboard();
    render(<EventShare event={geolocated} />);
    const share = screen.getByRole("button", { name: "Share" });
    expect(share).not.toHaveAttribute("aria-haspopup");

    await act(async () => {
      fireEvent.click(share);
    });
    expect(writeText).toHaveBeenCalledWith(URL_OF_E1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("turns the mark into a check, shows and announces the copy, then turns back", async () => {
    withClipboard();
    render(<EventShare event={geolocated} />);
    const share = screen.getByRole("button", { name: "Share" });
    expect(visibleMark(share)).toBe("share");

    await act(async () => {
      fireEvent.click(share);
    });
    expect(visibleMark(share)).toBe("check");
    // The name holds still: the tooltip shows the confirmation, and a live region says it.
    expect(screen.getByRole("button", { name: "Share" })).toBe(share);
    const [status, bubble] = screen.getAllByText("Link copied");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(bubble).toHaveAttribute("aria-hidden", "true");

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(visibleMark(share)).toBe("share");
    expect(screen.queryByText("Link copied")).toBeNull();
  });

  it("arms a detected row's share on the first click rather than copying", async () => {
    const writeText = withClipboard();
    render(<EventShare event={{ ...geolocated, status: "detected" }} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share" }));
    });
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByText("Detected and may still change. Click again to share.")).toBeVisible();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share" }));
    });
    expect(writeText).toHaveBeenCalledWith(URL_OF_E1);
  });
});

describe("EventShare with the Web Share API", () => {
  it("opens the share sheet with the event's address and title, and copies nothing", () => {
    const share = withWebShare();
    const writeText = withClipboard();
    render(<EventShare event={geolocated} />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    expect(share).toHaveBeenCalledWith({ title: "Strike near Bakhmut", url: URL_OF_E1 });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("arms a detected row's share on the first click rather than opening it", () => {
    const share = withWebShare();
    render(<EventShare event={{ ...geolocated, status: "detected" }} />);

    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(share).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(share).toHaveBeenCalledTimes(1);
  });
});
