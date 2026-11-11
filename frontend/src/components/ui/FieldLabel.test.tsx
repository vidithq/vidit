import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FieldLabel } from "./FieldLabel";

describe("FieldLabel", () => {
  it("makes the whole row the label when it holds only the words", () => {
    const { container } = render(
      <>
        <FieldLabel htmlFor="email" label="Email" />
        <input id="email" />
      </>,
    );

    expect(container.firstElementChild?.tagName).toBe("LABEL");
    expect(screen.getByLabelText("Email")).toHaveAttribute("id", "email");
  });

  it("keeps the help mark outside the label, so the field's name is the words alone", () => {
    render(
      <>
        <FieldLabel htmlFor="title" label="Title" trailing={<span>3/80</span>} />
        <input id="title" />
      </>,
    );

    expect(screen.getByRole("textbox", { name: "Title" })).toBeInTheDocument();
  });
});
