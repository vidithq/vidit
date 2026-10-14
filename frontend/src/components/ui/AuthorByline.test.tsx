import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AuthorByline } from "./AuthorByline";

describe("<AuthorByline>", () => {
  it("prints the Vidit username without @ and links the profile", () => {
    const { container } = render(<AuthorByline author={{ username: "ana" }} />);
    expect(screen.getByRole("link", { name: "ana" })).toHaveAttribute("href", "/profile/ana");
    expect(container.textContent).toBe("by ana");
  });

  it("drops the prefix and the link on request", () => {
    const { container } = render(
      <AuthorByline author={{ username: "ana" }} prefix={false} link={false} />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toBe("ana");
  });
});
