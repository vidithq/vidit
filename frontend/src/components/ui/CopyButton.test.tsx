import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CopyButton } from "./CopyButton";

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  // jsdom ships no Clipboard API.
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

describe("CopyButton", () => {
  it("writes the value read from the getter and announces the copied confirmation", async () => {
    render(<CopyButton value={() => "48.0, 37.8"} label="Copy coordinates" />);
    const button = screen.getByRole("button", { name: "Copy coordinates" });
    fireEvent.click(button);
    expect(writeText).toHaveBeenCalledWith("48.0, 37.8");
    // The accessible name stays constant; the confirmation lands in the
    // sibling live region, not a renamed button.
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Link copied")
    );
    expect(
      screen.getByRole("button", { name: "Copy coordinates" })
    ).toBeInTheDocument();
  });

  it("announces a custom copiedLabel", async () => {
    render(
      <CopyButton
        value={() => "x"}
        label="Copy code"
        copiedLabel="Code copied"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Code copied")
    );
  });

  it("cancels the write when beforeCopy returns false (the armed first click)", () => {
    const beforeCopy = vi.fn(() => false);
    render(
      <CopyButton value={() => "x"} label="Copy link" beforeCopy={beforeCopy} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(beforeCopy).toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("stays silent when the clipboard write is refused", async () => {
    writeText.mockRejectedValue(new Error("insecure context"));
    render(<CopyButton value={() => "x"} label="Copy link" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("names the action in the tooltip, `title` overriding the label", () => {
    render(
      <CopyButton value={() => "ABC123"} label="ABC123…" title="Copy ABC123456" />
    );
    expect(screen.getByRole("button")).toHaveAttribute("title", "Copy ABC123456");
  });

  it("defaults the tooltip to the label", () => {
    render(<CopyButton value={() => "x"} label="Copy link" />);
    expect(screen.getByRole("button")).toHaveAttribute("title", "Copy link");
  });
});
