import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ErrorNotice, FieldError } from "./ErrorNotice";

const noAnswer = {
  title: "Vidit does not respond",
  message: "Check your connection, then retry.",
  fields: {},
};

describe("ErrorNotice", () => {
  it("leads a fault the reader did not cause with its title, and retries it", () => {
    const onRetry = vi.fn();
    render(<ErrorNotice error={noAnswer} onRetry={onRetry} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Vidit does not respond");
    expect(alert).toHaveTextContent("Check your connection, then retry.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("says a refusal on one line, with no Retry that would meet the same refusal", () => {
    render(
      <ErrorNotice
        error={{ title: null, message: "This invite code was already used.", fields: {} }}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("This invite code was already used.");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("takes a plain string, and renders nothing for no error", () => {
    const { rerender, container } = render(<ErrorNotice error="Pick at least one conflict." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Pick at least one conflict.");
    rerender(<ErrorNotice error={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("FieldError", () => {
  it("is the field's description, announced only when asked", () => {
    const { rerender } = render(
      <FieldError id="handle-error">15 characters at most: letters, digits and _.</FieldError>,
    );
    expect(screen.getByText("15 characters at most: letters, digits and _.").closest("p")).toHaveAttribute(
      "id",
      "handle-error",
    );
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(<FieldError alert>Images and videos only.</FieldError>);
    expect(screen.getByRole("alert")).toHaveTextContent("Images and videos only.");
  });

  it("renders nothing without a message", () => {
    const { container } = render(<FieldError>{undefined}</FieldError>);
    expect(container).toBeEmptyDOMElement();
  });
});
