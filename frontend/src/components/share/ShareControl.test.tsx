import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShareControl } from "./ShareControl";

const PATH = "/events/e1";
const TITLE = "Strike near Bakhmut";
const CAVEAT = "Detected and may still change.";
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

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (navigator as { share?: unknown }).share;
});

describe("ShareControl without the Web Share API", () => {
  it("copies the address in one click, with no menu", async () => {
    const writeText = withClipboard();
    render(<ShareControl path={PATH} title={TITLE} />);
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
    render(<ShareControl path={PATH} title={TITLE} />);
    const share = screen.getByRole("button", { name: "Share" });

    await act(async () => {
      fireEvent.click(share);
    });
    // The name holds still: the tooltip shows the confirmation, and a live region says it.
    expect(screen.getByRole("button", { name: "Share" })).toBe(share);
    const [status, bubble] = screen.getAllByText("Link copied");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(bubble).toHaveAttribute("aria-hidden", "true");

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByText("Link copied")).toBeNull();
  });

  it("arms a caveated share on the first click rather than copying", async () => {
    const writeText = withClipboard();
    render(<ShareControl path={PATH} title={TITLE} caveat={CAVEAT} />);

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

describe("ShareControl with the Web Share API", () => {
  it("opens the share sheet with the address and title, and copies nothing", () => {
    const share = withWebShare();
    const writeText = withClipboard();
    render(<ShareControl path={PATH} title={TITLE} />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    expect(share).toHaveBeenCalledWith({ title: "Strike near Bakhmut", url: URL_OF_E1 });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("arms a caveated share on the first click rather than opening it", () => {
    const share = withWebShare();
    render(<ShareControl path={PATH} title={TITLE} caveat={CAVEAT} />);

    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(share).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(share).toHaveBeenCalledTimes(1);
  });
});
