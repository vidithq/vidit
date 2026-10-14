import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OutboundLink } from "./OutboundLink";

const UNKNOWN = "https://example.org/a/very/long/path?q=1";

describe("OutboundLink", () => {
  it("opens a known host in a new tab in one click", () => {
    render(<OutboundLink href="https://t.me/channel/4">post</OutboundLink>);
    const a = screen.getByRole("link", { name: "post" });
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noopener noreferrer");
    expect(fireEvent.click(a)).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("holds a click on an unknown host and shows the full URL", () => {
    render(<OutboundLink href={UNKNOWN}>site</OutboundLink>);
    const a = screen.getByRole("link", { name: "site" });
    expect(fireEvent.click(a)).toBe(false);
    const dialog = screen.getByRole("dialog", { name: "Leave Vidit?" });
    expect(dialog).toHaveTextContent(UNKNOWN);
    expect(dialog).toHaveTextContent("example.org");
    expect(a).toHaveAttribute("aria-expanded", "true");
  });

  it("leaves through an explicit confirmation", () => {
    render(<OutboundLink href={UNKNOWN} ugc>site</OutboundLink>);
    fireEvent.click(screen.getByRole("link", { name: "site" }));
    const confirm = screen.getByRole("link", { name: "Open link" });
    expect(confirm).toHaveAttribute("href", UNKNOWN);
    expect(confirm).toHaveAttribute("target", "_blank");
    expect(confirm).toHaveAttribute("rel", "noopener noreferrer nofollow ugc");
  });

  it("asks on a middle click too", () => {
    render(<OutboundLink href={UNKNOWN}>site</OutboundLink>);
    const a = screen.getByRole("link", { name: "site" });
    expect(fireEvent(a, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }))).toBe(
      false,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes on Cancel and on Escape", () => {
    render(<OutboundLink href={UNKNOWN}>site</OutboundLink>);
    const a = screen.getByRole("link", { name: "site" });
    fireEvent.click(a);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(a).toHaveFocus();

    fireEvent.click(a);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
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
