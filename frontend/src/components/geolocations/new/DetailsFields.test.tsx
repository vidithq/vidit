import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FORM_INVALID_LABEL } from "@/components/ui/form-styles";

import { DetailsFields } from "./DetailsFields";

const baseProps = {
  sourceUrl: "",
  setSourceUrl: () => {},
  secondarySourceUrls: [] as string[],
  setSecondarySourceUrls: () => {},
  eventDate: "",
  setEventDate: () => {},
  eventTime: "",
  setEventTime: () => {},
  sourcePostedAt: "",
  setSourcePostedAt: () => {},
  sourceUrlLocked: false,
};

const SOURCE_PLACEHOLDER = "https://t.me/channel/12345";

describe("DetailsFields", () => {
  it("renders the Details heading, the date + source fields, and their ? help", () => {
    render(<DetailsFields {...baseProps} />);
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getByText("Event date")).toBeInTheDocument();
    expect(screen.getByText("Event time")).toBeInTheDocument();
    expect(screen.getByText("Source posted (UTC)")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(SOURCE_PLACEHOLDER)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "What is the event date?" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "What is the source post time?" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "What is the source?" })
    ).toBeInTheDocument();
  });

  it("carries no optional marker on the event date and event time", () => {
    render(<DetailsFields {...baseProps} />);
    expect(screen.queryByText("optional")).toBeNull();
  });

  it("does not render a title field (the title leads the form)", () => {
    render(<DetailsFields {...baseProps} />);
    expect(
      screen.queryByRole("button", { name: "What makes a good title?" })
    ).toBeNull();
  });

  it("leaves the source URL editable by default", () => {
    render(<DetailsFields {...baseProps} />);
    expect(screen.getByPlaceholderText(SOURCE_PLACEHOLDER)).not.toHaveAttribute(
      "readonly"
    );
  });

  it("locks the source URL in request-fulfilment mode", () => {
    render(
      <DetailsFields {...baseProps} sourceUrlLocked sourceUrl="https://t.me/c/1" />
    );
    expect(screen.getByPlaceholderText(SOURCE_PLACEHOLDER)).toHaveAttribute(
      "readonly"
    );
  });

  it("flags a missing field's label red, same as its input outline", () => {
    render(
      <DetailsFields
        {...baseProps}
        sourcePostedAtInvalid
        sourceUrlInvalid
      />
    );
    // Every invalid field's own label turns red, matching the outline already
    // applied to its input (via `Input`'s `invalid` prop): the same
    // treatment, not just one or the other.
    expect(screen.getByText("Source posted (UTC)").closest("label")).toHaveClass(
      FORM_INVALID_LABEL
    );
    expect(screen.getByText("Source URL").closest("label")).toHaveClass(
      FORM_INVALID_LABEL
    );
    // Event date and time are never required, so they never get flagged.
    expect(screen.getByText("Event date").closest("label")).not.toHaveClass(
      FORM_INVALID_LABEL
    );
    expect(screen.getByText("Event time").closest("label")).not.toHaveClass(
      FORM_INVALID_LABEL
    );
  });

  it("offers the secondary sources list, empty and collapsed to its add button", () => {
    render(<DetailsFields {...baseProps} />);
    expect(screen.getByText("Secondary sources")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "What are secondary sources?" })
    ).toBeInTheDocument();
    // No rows until one is added: an optional field starts out of the way.
    expect(screen.queryByLabelText("Secondary source 1")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Add secondary source" })
    ).toBeEnabled();
  });

  it("renders one field per secondary source, in order", () => {
    render(
      <DetailsFields
        {...baseProps}
        secondarySourceUrls={["https://t.me/c/2", "https://x.com/u/status/3"]}
      />
    );
    expect(screen.getByLabelText("Secondary source 1")).toHaveValue(
      "https://t.me/c/2"
    );
    expect(screen.getByLabelText("Secondary source 2")).toHaveValue(
      "https://x.com/u/status/3"
    );
  });

  it("keeps the secondary sources editable while the primary is locked", () => {
    const setSecondarySourceUrls = vi.fn();
    render(
      <DetailsFields
        {...baseProps}
        sourceUrlLocked
        sourceUrl="https://t.me/c/1"
        secondarySourceUrls={["https://t.me/c/2"]}
        setSecondarySourceUrls={setSecondarySourceUrls}
      />
    );
    const row = screen.getByLabelText("Secondary source 1");
    expect(row).not.toHaveAttribute("readonly");
    fireEvent.change(row, { target: { value: "https://t.me/c/9" } });
    expect(setSecondarySourceUrls).toHaveBeenCalledWith(["https://t.me/c/9"]);
  });
});
