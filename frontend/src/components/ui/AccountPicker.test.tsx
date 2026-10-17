import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AccountPicker, type Account } from "./AccountPicker";

const ANA: Account = { kind: "analyst", username: "ana" };
const BO: Account = { kind: "analyst", username: "bo" };
const OSW: Account = { kind: "organization", slug: "osw", name: "Open Source Watch" };

function field() {
  return screen.getByRole("combobox");
}

describe("<AccountPicker>", () => {
  it("filters local options by name and handle and picks with the arrows and Enter", () => {
    const onSelect = vi.fn();
    render(
      <AccountPicker
        aria-label="Account"
        options={[ANA, BO, OSW]}
        onSelect={onSelect}
        emptyText="Nobody"
      />,
    );

    fireEvent.focus(field());
    expect(field()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("option")).toHaveLength(3);

    fireEvent.change(field(), { target: { value: "os" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "Open Source Watch osw" })).toBeInTheDocument();

    fireEvent.change(field(), { target: { value: "" } });
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    const active = screen.getByRole("option", { selected: true });
    expect(active).toHaveTextContent("bo");
    expect(field()).toHaveAttribute("aria-activedescendant", active.id);

    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(BO);
    expect(field()).toHaveValue("");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("wraps the arrows around the list", () => {
    render(
      <AccountPicker aria-label="Account" options={[ANA, BO]} onSelect={vi.fn()} emptyText="" />,
    );
    fireEvent.focus(field());
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent("bo");
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent("ana");
  });

  it("closes on Escape and on blur, and reopens on ArrowDown", () => {
    render(
      <AccountPicker aria-label="Account" options={[ANA]} onSelect={vi.fn()} emptyText="" />,
    );
    fireEvent.focus(field());
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.blur(field());
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("picks a row on click", () => {
    const onSelect = vi.fn();
    render(
      <AccountPicker aria-label="Account" options={[ANA, OSW]} onSelect={onSelect} emptyText="" />,
    );
    fireEvent.focus(field());
    fireEvent.click(screen.getByRole("option", { name: /Open Source Watch/ }));
    expect(onSelect).toHaveBeenCalledWith(OSW);
  });

  it("shows the empty text as a muted row, and hands typed text to onSubmitText", () => {
    const onSubmitText = vi.fn();
    render(
      <AccountPicker
        aria-label="Account"
        options={[ANA]}
        onSelect={vi.fn()}
        onSubmitText={onSubmitText}
        emptyText="Nobody matches"
      />,
    );
    fireEvent.change(field(), { target: { value: "zed" } });
    expect(screen.getByRole("status")).toHaveTextContent("Nobody matches");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSubmitText).toHaveBeenCalledWith("zed");
  });

  it("searches once typing stops, past the minimum length, and shows a note", async () => {
    const search = vi.fn().mockResolvedValue({ accounts: [ANA], note: "bob already approved" });
    render(
      <AccountPicker
        aria-label="Account"
        search={search}
        minQueryLength={2}
        onSelect={vi.fn()}
        emptyText="Nobody"
      />,
    );
    fireEvent.change(field(), { target: { value: "a" } });
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.change(field(), { target: { value: "an" } });
    expect(screen.getByRole("status")).toHaveTextContent("Searching…");

    expect(await screen.findByRole("option", { name: "ana" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("bob already approved");
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("an");
  });

  it("says so when the search fails", async () => {
    render(
      <AccountPicker
        aria-label="Account"
        search={() => Promise.reject(new Error("down"))}
        onSelect={vi.fn()}
        emptyText="Nobody"
      />,
    );
    fireEvent.focus(field());
    expect(await screen.findByText("Could not load suggestions")).toBeInTheDocument();
  });

  it("shows the selected account as a chip that clears it", () => {
    const onClear = vi.fn();
    render(
      <AccountPicker
        aria-label="Account"
        options={[ANA]}
        selected={ANA}
        onSelect={vi.fn()}
        onClear={onClear}
        emptyText=""
      />,
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ana" }));
    expect(onClear).toHaveBeenCalled();
  });
});
