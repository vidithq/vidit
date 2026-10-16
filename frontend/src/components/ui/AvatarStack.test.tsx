import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AvatarStack, type AvatarStackItem } from "./AvatarStack";

const item = (name: string): AvatarStackItem => ({
  key: name,
  name,
  variant: "analyst",
  label: `Approved by ${name}`,
  renderCard: () => <a href={`#${name}`}>View profile</a>,
});

function Row({ names }: { names: string[] }) {
  return (
    <>
      <AvatarStack items={names.map(item)} label="Approved by" />
      <button type="button">After the row</button>
    </>
  );
}

describe("<AvatarStack>", () => {
  it("renders nothing for no item", () => {
    const { container } = render(<AvatarStack items={[]} label="Approved by" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the card on hover and on focus, without following a link", () => {
    render(<Row names={["maya"]} />);
    const stamp = screen.getByRole("button", { name: "Approved by maya" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.mouseEnter(stamp.parentElement!);
    expect(screen.getByRole("dialog", { name: "maya" })).toBeInTheDocument();
    fireEvent.mouseLeave(stamp.parentElement!);

    fireEvent.focus(stamp);
    expect(screen.getByRole("dialog", { name: "maya" })).toBeInTheDocument();
    fireEvent.blur(stamp);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("pins on click, moves focus in, and returns it to the stamp on Escape", () => {
    render(<Row names={["maya"]} />);
    const stamp = screen.getByRole("button", { name: "Approved by maya" });
    fireEvent.click(stamp);
    const link = screen.getByRole("link", { name: "View profile" });
    expect(link).toHaveFocus();
    fireEvent.keyDown(link, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(stamp).toHaveFocus();
  });

  it("holds the pinned card while focus is inside it, even when the pointer leaves", () => {
    render(<Row names={["maya"]} />);
    const stamp = screen.getByRole("button", { name: "Approved by maya" });
    fireEvent.mouseEnter(stamp.parentElement!);
    fireEvent.click(stamp);
    fireEvent.mouseLeave(stamp.parentElement!);
    expect(screen.getByRole("link", { name: "View profile" })).toHaveFocus();
  });

  it("sends Shift+Tab back to the stamp and Tab on to what follows it", () => {
    render(<Row names={["maya", "bo"]} />);
    const maya = screen.getByRole("button", { name: "Approved by maya" });

    fireEvent.click(maya);
    fireEvent.keyDown(screen.getByRole("link", { name: "View profile" }), {
      key: "Tab",
      shiftKey: true,
    });
    expect(maya).toHaveFocus();

    fireEvent.click(maya);
    expect(screen.getByRole("link", { name: "View profile" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("link", { name: "View profile" }), { key: "Tab" });
    expect(screen.getByRole("button", { name: "Approved by bo" })).toHaveFocus();
  });

  it("prints a static bubble past max when nothing opens the rest", () => {
    render(<AvatarStack items={["a", "b", "c"].map(item)} label="Approved by" max={2} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByText("+1")).toBeInTheDocument();
  });

  it("makes an item with href a link whose card is a tooltip", () => {
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
            renderCard: () => "Open Source Watch",
          },
        ]}
      />,
    );
    const logo = screen.getByRole("link", { name: "Member of Open Source Watch" });
    expect(logo).toHaveAttribute("href", "/organizations/osw");
    expect(screen.queryByRole("button")).toBeNull();

    fireEvent.focus(logo);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Open Source Watch");
    expect(logo).toHaveAttribute("aria-describedby", tip.id);
    fireEvent.blur(logo);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
