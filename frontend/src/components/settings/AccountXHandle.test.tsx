import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AccountXHandle } from "./AccountXHandle";

describe("AccountXHandle", () => {
  it("shows the bound handle read-only", () => {
    render(<AccountXHandle xHandle="osint_hawk" />);

    expect(screen.getByText("@osint_hawk")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    // The only button is the label's help.
    expect(screen.getByRole("button")).toHaveAccessibleName("What is the X handle for?");
  });

  it("says so when no handle is linked", () => {
    render(<AccountXHandle xHandle={null} />);

    expect(screen.getByText("No X handle linked")).toBeInTheDocument();
  });
});
