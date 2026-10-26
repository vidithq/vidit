import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageError } from "./PageShell";

describe("PageError", () => {
  it("names the map by default", () => {
    render(<PageError message="Not found." backHref="/map" />);
    expect(screen.getByRole("link", { name: "Back to map" })).toHaveAttribute("href", "/map");
  });

  it("names where a back link leads when it is not the map", () => {
    render(<PageError message="Owner only." backHref="/sites/s1" backLabel="Back to the site" />);
    expect(screen.getByRole("link", { name: "Back to the site" })).toHaveAttribute("href", "/sites/s1");
  });
});
