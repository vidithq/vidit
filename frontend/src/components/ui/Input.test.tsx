import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Input, Textarea } from "./Input";

describe("invalid", () => {
  it("marks an input and a textarea invalid for assistive tech", () => {
    render(
      <>
        <Input aria-label="Name" invalid />
        <Textarea aria-label="Bio" invalid />
      </>,
    );
    expect(screen.getByRole("textbox", { name: "Name" })).toBeInvalid();
    expect(screen.getByRole("textbox", { name: "Bio" })).toBeInvalid();
  });

  it("leaves a valid field unmarked", () => {
    render(<Textarea aria-label="Bio" />);
    expect(screen.getByRole("textbox", { name: "Bio" })).not.toHaveAttribute("aria-invalid");
  });
});
