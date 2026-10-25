import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Popover } from "./Popover";

function Demo() {
  return (
    <>
      <Popover label="Invite a geolocator" icon={<span>+</span>}>
        {(close) => (
          <>
            <input aria-label="Username" aria-controls="owned-list" autoFocus />
            <button type="button" onClick={close}>
              Pick
            </button>
          </>
        )}
      </Popover>
      {/* A list a control in the panel owns, rendered elsewhere, as a portaled Combobox list. */}
      <ul id="owned-list">
        <li>bo</li>
      </ul>
      <p>Elsewhere</p>
    </>
  );
}

const trigger = () => screen.getByRole("button", { name: "Invite a geolocator" });
const panel = () => screen.queryByRole("dialog", { name: "Invite a geolocator" });

describe("<Popover>", () => {
  it("opens a named panel whose field takes focus", () => {
    render(<Demo />);
    expect(panel()).toBeNull();
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Username")).toHaveFocus();
  });

  it("takes focus itself when no field in it does, so Escape still closes it", () => {
    render(
      <Popover label="Add to collection" icon={<span>+</span>}>
        {() => <p>No field here</p>}
      </Popover>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add to collection" }));
    const dialog = screen.getByRole("dialog", { name: "Add to collection" });
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape and gives focus back to the trigger", () => {
    render(<Demo />);
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByLabelText("Username"), { key: "Escape" });
    expect(panel()).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it("closes on an outside click, but not on a click in a list the panel owns", () => {
    render(<Demo />);
    fireEvent.click(trigger());
    fireEvent.mouseDown(screen.getByText("bo"));
    expect(panel()).not.toBeNull();
    fireEvent.mouseDown(screen.getByText("Elsewhere"));
    expect(panel()).toBeNull();
  });

  it("hands its content the close", () => {
    render(<Demo />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: "Pick" }));
    expect(panel()).toBeNull();
  });
});
