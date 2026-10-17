import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AvatarStack, type AvatarStackItem } from "./AvatarStack";

const item = (name: string): AvatarStackItem => ({
  key: name,
  name,
  variant: "analyst",
  label: name,
  href: `/profile/${name}`,
});

const bubble = (text: string) =>
  [...document.body.querySelectorAll('[aria-hidden="true"]')].find((el) => el.textContent === text);

describe("<AvatarStack>", () => {
  it("renders nothing for no item", () => {
    const { container } = render(<AvatarStack items={[]} label="Approved by" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links each picture to its page and names it", () => {
    render(<AvatarStack items={["maya", "bo"].map(item)} label="Approved by" />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => [l.getAttribute("aria-label"), l.getAttribute("href")])).toEqual([
      ["maya", "/profile/maya"],
      ["bo", "/profile/bo"],
    ]);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the label in a tooltip while a mouse rests on the picture", () => {
    render(<AvatarStack items={[item("maya")]} label="Approved by" />);
    expect(bubble("maya")).toBeUndefined();
    fireEvent.pointerEnter(screen.getByRole("link", { name: "maya" }), { pointerType: "mouse" });
    expect(bubble("maya")).toBeDefined();
  });

  it("prints a static bubble past max when nothing opens the rest", () => {
    render(<AvatarStack items={["a", "b", "c"].map(item)} label="Approved by" max={2} />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("+1")).toBeInTheDocument();
  });

  it("makes the bubble a button when the rest can be shown", () => {
    const onOverflow = vi.fn();
    render(
      <AvatarStack
        items={["a", "b", "c"].map(item)}
        label="Approved by"
        max={2}
        onOverflow={onOverflow}
        overflowLabel={(n) => `Show ${n} more`}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show 1 more" }));
    expect(onOverflow).toHaveBeenCalled();
  });

  it("squares an organization's logo", () => {
    render(
      <AvatarStack
        label="Organizations"
        items={[
          {
            key: "osw",
            name: "Open Source Watch",
            variant: "organization",
            label: "Member of Open Source Watch",
            href: "/organizations/osw",
          },
        ]}
      />,
    );
    const logo = screen.getByRole("link", { name: "Member of Open Source Watch" });
    expect(logo).toHaveAttribute("href", "/organizations/osw");
    expect(logo.className).toContain("rounded-md");
  });
});
