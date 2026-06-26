import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IncompleteFormNotice } from "./IncompleteFormNotice";

describe("IncompleteFormNotice", () => {
  it("renders nothing when nothing is missing", () => {
    const { container } = render(<IncompleteFormNotice missing={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists every missing field at once under an alert", () => {
    render(<IncompleteFormNotice missing={["Title", "Proof", "Source media"]} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Proof")).toBeInTheDocument();
    expect(screen.getByText("Source media")).toBeInTheDocument();
  });

  it("uses a custom lead when given", () => {
    render(<IncompleteFormNotice missing={["Title"]} lead="Almost there:" />);
    expect(screen.getByText("Almost there:")).toBeInTheDocument();
  });
});
