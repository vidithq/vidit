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

  it("puts a remove control on a picture's corner, beside its link", () => {
    const onClick = vi.fn();
    render(
      <AvatarStack
        items={[{ ...item("maya"), remove: { label: "Delete approval by maya", onClick } }, item("bo")]}
        label="Approved by"
      />,
    );
    const remove = screen.getByRole("button", { name: "Delete approval by maya" });
    expect(remove.closest("a")).toBeNull();
    expect(remove.closest("li")).toContainElement(screen.getByRole("link", { name: "maya" }));
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(remove);
    expect(onClick).toHaveBeenCalledOnce();
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
