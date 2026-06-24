import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DetailsFields } from "./DetailsFields";

const baseProps = {
  sourceUrl: "",
  setSourceUrl: () => {},
  eventDate: "",
  setEventDate: () => {},
  sourceDate: "",
  setSourceDate: () => {},
  lockedFromBounty: false,
};

const SOURCE_PLACEHOLDER = "https://t.me/channel/12345";

describe("DetailsFields", () => {
  it("renders the Details heading, the date + source fields, and their ? help", () => {
    render(<DetailsFields {...baseProps} />);
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getByText("Event date")).toBeInTheDocument();
    expect(screen.getByText("Source date")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(SOURCE_PLACEHOLDER)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "What is the Event date?" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "What is the Source date?" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "What is the Source URL?" })
    ).toBeInTheDocument();
  });

  it("marks the source date optional (it is the only optional field here)", () => {
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

  it("locks the source URL in bounty-fulfilment mode", () => {
    render(
      <DetailsFields {...baseProps} lockedFromBounty sourceUrl="https://t.me/c/1" />
    );
    expect(screen.getByPlaceholderText(SOURCE_PLACEHOLDER)).toHaveAttribute(
      "readonly"
    );
  });

  it("hides the dates when showDates is false (bounty mode), keeping the source URL", () => {
    render(<DetailsFields {...baseProps} showDates={false} />);
    expect(screen.queryByText("Event date")).toBeNull();
    expect(screen.queryByText("Source date")).toBeNull();
    expect(screen.getByPlaceholderText(SOURCE_PLACEHOLDER)).toBeInTheDocument();
  });
});
