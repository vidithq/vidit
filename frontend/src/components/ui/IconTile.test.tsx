import { render, screen } from "@testing-library/react";
import { Archive } from "lucide-react";
import { describe, expect, it } from "vitest";

import { IconTile } from "./IconTile";

describe("IconTile", () => {
  it("is one link carrying the title and the note", () => {
    render(<IconTile icon={<Archive />} title="Upload your X archive" note="Your whole history, once." href="#archive" />);

    const link = screen.getByRole("link", { name: /Upload your X archive/ });
    expect(link).toHaveAttribute("href", "#archive");
    expect(link).toHaveTextContent("Your whole history, once.");
  });

  it("hides the preview from assistive tech and lists the needs", () => {
    render(
      <IconTile
        icon={<Archive />}
        title="Bulk import"
        href="/submit?mode=bulk"
        preview={<span>drawing</span>}
        needs={["X archive", "Linked X account"]}
      />,
    );

    const link = screen.getByRole("link", { name: /^Bulk import/ });
    expect(link).not.toHaveAccessibleName(/drawing/);
    expect(link).toHaveTextContent("NeedsX archiveLinked X account");
  });

  it("is inert without an href", () => {
    render(<IconTile icon={<Archive />} title="Approve" />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Approve" })).toBeInTheDocument();
  });
});
