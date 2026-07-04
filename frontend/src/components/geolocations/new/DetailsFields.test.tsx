import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DetailsFields } from "./DetailsFields";

const baseProps = {
  sourceUrl: "",
  setSourceUrl: () => {},
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

  it("marks the event time optional (the only optional field by default)", () => {
    render(<DetailsFields {...baseProps} />);
    expect(screen.getByText("optional")).toBeInTheDocument();
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

  it("marks the event date optional too when eventDateRequired is false (request)", () => {
    render(<DetailsFields {...baseProps} eventDateRequired={false} />);
    // Both the event date and the event time now carry the optional marker.
    expect(screen.getAllByText("optional")).toHaveLength(2);
  });
});
