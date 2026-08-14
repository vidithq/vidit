import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Avatar } from "./Avatar";

describe("Avatar", () => {
  it("names the picture after its owner", () => {
    render(<Avatar src="https://cdn.example.com/a.jpg" username="analyst" size="size-10" />);

    expect(screen.getByAltText("analyst's avatar")).toHaveAttribute(
      "src",
      "https://cdn.example.com/a.jpg",
    );
  });

  it("drops the alt text when the host already names itself", () => {
    const { container } = render(
      <Avatar
        src="https://cdn.example.com/a.jpg"
        username="analyst"
        size="size-10"
        decorative
      />,
    );

    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });

  // An `avatar_url` is typed by its owner, so it can 404 or be blocked as
  // mixed content. The circle falls back instead of showing a broken image.
  it("falls back to the initial when the picture fails to load", () => {
    const { container } = render(
      <Avatar src="https://cdn.example.com/gone.jpg" username="analyst" size="size-10" />,
    );

    fireEvent.error(container.querySelector("img")!);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("retries once the owner types a different URL", () => {
    const { container, rerender } = render(
      <Avatar src="https://cdn.example.com/gone.jpg" username="analyst" size="size-10" />,
    );
    fireEvent.error(container.querySelector("img")!);

    rerender(
      <Avatar src="https://cdn.example.com/new.jpg" username="analyst" size="size-10" />,
    );

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://cdn.example.com/new.jpg",
    );
  });

  it("hands the icon fallback's colour to the caller", () => {
    const { container } = render(
      <Avatar
        username="analyst"
        size="size-10"
        fallback="icon"
        iconClassName="text-current"
      />,
    );

    expect(container.querySelector("svg")).toHaveClass("text-current");
  });
});
