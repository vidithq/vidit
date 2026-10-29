import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OutboundLink } from "./OutboundLink";

const UNKNOWN = "https://example.org/a/very/long/path?q=1";

function openWarning(ugc = false) {
  render(
    <OutboundLink href={UNKNOWN} ugc={ugc}>
      site
    </OutboundLink>,
  );
  const link = screen.getByRole("link", { name: "site" });
  const followed = fireEvent.click(link);
  return { link, followed };
}

describe("OutboundLink", () => {
  it("opens a known host in a new tab in one click", () => {
    render(<OutboundLink href="https://t.me/channel/4">post</OutboundLink>);
    const a = screen.getByRole("link", { name: "post" });
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noopener noreferrer");
    expect(fireEvent.click(a)).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("routes a Vidit path in the app", () => {
    render(<OutboundLink href="https://vidit.app/events/1?tab=proof#map">event</OutboundLink>);
    const a = screen.getByRole("link", { name: "event" });
    expect(a).toHaveAttribute("href", "/events/1?tab=proof#map");
    expect(a).not.toHaveAttribute("target");
  });

  it.each([
    ["https://vidit.app//evil.example/x", "https://evil.example/x"],
    ["https://vidit.app/\\evil.example", "https://evil.example/"],
  ])("asks before %s and names the host it reaches", (href, target) => {
    render(<OutboundLink href={href}>event</OutboundLink>);
    const a = screen.getByRole("link", { name: "event" });
    expect(a).toHaveAttribute("href", target);
    expect(fireEvent.click(a)).toBe(false);
    const dialog = screen.getByRole("dialog", { name: "Leave Vidit?" });
    expect(dialog).toHaveTextContent("goes to evil.example,");
    expect(screen.getByRole("link", { name: target })).toHaveAttribute("href", target);
  });

  it("holds a click on an unknown host in a modal dialog naming the host", () => {
    const { followed } = openWarning();
    expect(followed).toBe(false);
    const dialog = screen.getByRole("dialog", { name: "Leave Vidit?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveTextContent("example.org");
  });

  it("makes the full URL the only way on, and offers no other confirm", () => {
    openWarning(true);
    const url = screen.getByRole("link", { name: UNKNOWN });
    expect(url).toHaveAttribute("href", UNKNOWN);
    expect(url).toHaveAttribute("target", "_blank");
    expect(url).toHaveAttribute("rel", "noopener noreferrer nofollow ugc");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Cancel"]);
  });

  it("puts initial focus on Cancel and keeps Tab inside the dialog", () => {
    openWarning();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const url = screen.getByRole("link", { name: UNKNOWN });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(url).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(cancel).toHaveFocus();
  });

  it("asks on a middle click too", () => {
    render(<OutboundLink href={UNKNOWN}>site</OutboundLink>);
    const a = screen.getByRole("link", { name: "site" });
    const event = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 });
    expect(fireEvent(a, event)).toBe(false);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it.each([
    ["Cancel", () => fireEvent.click(screen.getByRole("button", { name: "Cancel" }))],
    ["Escape", () => fireEvent.keyDown(window, { key: "Escape" })],
    ["a backdrop click", () => fireEvent.click(screen.getByRole("dialog"))],
  ])("closes on %s and returns focus to the link", (_, dismiss) => {
    const { link } = openWarning();
    dismiss();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(link).toHaveFocus();
  });

  it("keeps a click inside the card from closing it", () => {
    openWarning();
    fireEvent.click(screen.getByText(/outside the sites Vidit opens directly/));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("routes a link to Vidit inside the app", () => {
    render(<OutboundLink href="https://vidit.app/collections/3?step=2">collection</OutboundLink>);
    const a = screen.getByRole("link", { name: "collection" });
    expect(a).toHaveAttribute("href", "/collections/3?step=2");
    expect(a).not.toHaveAttribute("target");
  });

  it("renders a value that is not an http(s) URL as text", () => {
    render(<OutboundLink href="javascript:alert(1)">text</OutboundLink>);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("text")).toBeInTheDocument();
  });
});
