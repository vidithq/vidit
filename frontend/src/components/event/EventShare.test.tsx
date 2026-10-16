import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { eventDetail } from "@/test/eventDetail";
import type { EventDetail } from "@/types";
import { EventShare } from "./EventShare";

const geolocated: EventDetail = {
  ...eventDetail("e1", "Strike near Bakhmut"),
  event_date: "2026-06-01",
  event_coords: { lat: 48.5, lng: 37.8 },
};

/** The intent URL a share opened, decoded into `text` and `url` so a spec reads the post body and link. */
function openedIntent(openMock: ReturnType<typeof vi.fn>) {
  expect(openMock).toHaveBeenCalledTimes(1);
  const [href, target, features] = openMock.mock.calls[0];
  const url = new URL(href as string);
  return {
    origin: url.origin,
    pathname: url.pathname,
    text: url.searchParams.get("text"),
    sharedUrl: url.searchParams.get("url"),
    target,
    features,
  };
}

function withWebShare() {
  const share = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "share", { value: share, configurable: true });
  return share;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (navigator as { share?: unknown }).share;
});

describe("EventShare without the Web Share API", () => {
  it("opens a menu with Copy link and Share on X", () => {
    render(<EventShare event={geolocated} />);
    const trigger = screen.getByRole("button", { name: "Share" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.click(trigger);

    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Copy link",
      "Share on X",
    ]);
  });

  it("opens the X composer with the title, the byline and the coordinates, plus the event's url", () => {
    const openMock = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<EventShare event={geolocated} />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Share on X" }));

    const intent = openedIntent(openMock);
    expect(intent.origin).toBe("https://twitter.com");
    expect(intent.pathname).toBe("/intent/tweet");
    expect(intent.text).toBe("Strike near Bakhmut\nby ana · 1 Jun 2026\n48.500000, 37.800000");
    expect(intent.sharedUrl).toBe(`${window.location.origin}/events/e1`);
    expect(intent.target).toBe("_blank");
    expect(intent.features).toBe("noopener,noreferrer");
  });

  it("drops the date line and the coordinate line when the event carries neither", () => {
    const openMock = vi.spyOn(window, "open").mockImplementation(() => null);
    render(
      <EventShare
        event={{ ...geolocated, status: "requested", event_date: null, event_coords: null }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Share on X" }));

    expect(openedIntent(openMock).text).toBe("Strike near Bakhmut\nby ana");
  });

  it("copies the event's address and says so", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<EventShare event={geolocated} />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/events/e1`);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Link copied"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("prints a detected row's caveat above the items", () => {
    render(<EventShare event={{ ...geolocated, status: "detected" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    expect(screen.getByRole("menu")).toHaveTextContent("Detected and may still change.");
  });
});

describe("EventShare with the Web Share API", () => {
  it("opens the share sheet with the event's address and title", () => {
    const share = withWebShare();
    render(<EventShare event={geolocated} />);
    const trigger = screen.getByRole("button", { name: "Share" });
    expect(trigger).not.toHaveAttribute("aria-haspopup");
    fireEvent.click(trigger);

    expect(share).toHaveBeenCalledWith({
      title: "Strike near Bakhmut",
      url: `${window.location.origin}/events/e1`,
    });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("arms a detected row's share on the first click rather than opening it", () => {
    const share = withWebShare();
    render(<EventShare event={{ ...geolocated, status: "detected" }} />);

    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(share).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Detected and may still change. Click again to share.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(share).toHaveBeenCalledTimes(1);
  });
});
