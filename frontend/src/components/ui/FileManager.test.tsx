import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FileManager, type FileManagerItem } from "./FileManager";

const baseProps = {
  accept: "image/*",
  addLabel: "Add media",
};

describe("FileManager", () => {
  it("renders a non-viewable item's content directly, with no view button", () => {
    const items: FileManagerItem[] = [
      { key: "a", content: <img alt="plain" src="/a.jpg" /> },
    ];
    render(<FileManager {...baseProps} items={items} />);
    expect(screen.getByAltText("plain")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /view/i })).toBeNull();
  });

  it("opens the lightbox with the item's viewContent on tile click, and closes on the close button", () => {
    const items: FileManagerItem[] = [
      {
        key: "a",
        content: <img alt="thumb" src="/a-thumb.jpg" />,
        viewContent: <img alt="enlarged" src="/a-hero.jpg" />,
        viewLabel: "View image",
      },
    ];
    render(<FileManager {...baseProps} items={items} />);

    expect(screen.queryByAltText("enlarged")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View image" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByAltText("enlarged")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the lightbox on Escape", () => {
    const items: FileManagerItem[] = [
      {
        key: "a",
        content: <img alt="thumb" src="/a-thumb.jpg" />,
        viewContent: <img alt="enlarged" src="/a-hero.jpg" />,
      },
    ];
    render(<FileManager {...baseProps} items={items} />);
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps remove and view as unambiguous, separate clicks: removing a viewable item never opens the lightbox", () => {
    const onRemove = vi.fn();
    const items: FileManagerItem[] = [
      {
        key: "a",
        content: <img alt="thumb" src="/a-thumb.jpg" />,
        viewContent: <img alt="enlarged" src="/a-hero.jpg" />,
        onRemove,
        removeLabel: "Remove media",
      },
    ];
    render(<FileManager {...baseProps} items={items} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove media" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();

    // The view button is still there and still opens the lightbox on its own.
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
