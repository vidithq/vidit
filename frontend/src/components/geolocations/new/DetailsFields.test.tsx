import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DetailsFields } from "./DetailsFields";

const baseProps = {
  title: "",
  setTitle: () => {},
  sourceUrl: "",
  setSourceUrl: () => {},
  eventDate: "",
  setEventDate: () => {},
  lockedFromBounty: false,
};

const SOURCE_PLACEHOLDER = "https://t.me/channel/12345";

describe("DetailsFields", () => {
  it("renders the Details heading, the three fields, and their ? help", () => {
    render(<DetailsFields {...baseProps} />);
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/Strike on ammunition depot/)
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText(SOURCE_PLACEHOLDER)).toBeInTheDocument();
    expect(screen.getByText("Event date")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "What makes a good title?" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "What is the Event date?" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "What is the Source URL?" })
    ).toBeInTheDocument();
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
});
