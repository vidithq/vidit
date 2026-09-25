import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ShareButtons from "./ShareButtons";

/** The intent URL a share opened, decoded back into its `text` and `url`
 *  parameters, so a spec reads the tweet body and the link rather than the
 *  raw query string. */
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

describe("ShareButtons", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the X composer with the title, the byline and the coordinates, plus the event's url", () => {
    const openMock = vi.spyOn(window, "open").mockImplementation(() => null);

    render(
      <ShareButtons
        id="e1"
        title="Strike near Bakhmut"
        author="ana"
        eventDate="2026-06-01"
        lat={48.5}
        lng={37.8}
        status="geolocated"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Share on X" }));

    const intent = openedIntent(openMock);
    expect(intent.origin).toBe("https://twitter.com");
    expect(intent.pathname).toBe("/intent/tweet");
    expect(intent.text).toBe(
      "Strike near Bakhmut\nby ana · 1 Jun 2026\n48.500000, 37.800000",
    );
    expect(intent.sharedUrl).toBe(`${window.location.origin}/events/e1`);
    expect(intent.target).toBe("_blank");
    expect(intent.features).toBe("noopener,noreferrer");
  });

  it("drops the date line and the coordinate line when the event carries neither", () => {
    const openMock = vi.spyOn(window, "open").mockImplementation(() => null);

    render(
      <ShareButtons
        id="e2"
        title="Requested strike"
        author="bo"
        eventDate={null}
        lat={null}
        lng={null}
        status="requested"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Share on X" }));

    expect(openedIntent(openMock).text).toBe("Requested strike\nby bo");
  });

  it("arms a detected row's share on the first click rather than opening it", () => {
    const openMock = vi.spyOn(window, "open").mockImplementation(() => null);

    render(
      <ShareButtons
        id="e3"
        title="Detected strike"
        author="ana"
        eventDate="2026-06-01"
        lat={48.5}
        lng={37.8}
        status="detected"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Share on X" }));
    expect(openMock).not.toHaveBeenCalled();
    expect(
      screen.getByText("Detected and may still change. Click again to share."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Share on X" }));
    expect(openMock).toHaveBeenCalledTimes(1);
  });
});
