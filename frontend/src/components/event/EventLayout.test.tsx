import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FORM_INVALID_LABEL } from "@/components/ui/form-styles";

import { EVENT_SECTIONS, EventLayout } from "./EventLayout";

const slots = {
  sources: <div>sources row</div>,
  proof: { content: <div>proof card</div> },
  details: { content: <div>details card</div> },
};

const heading = (name: string) => screen.getByRole("heading", { name: new RegExp(`^${name}`) });

describe("EventLayout", () => {
  it("heads each section with its eyebrow from the one table", () => {
    render(<EventLayout {...slots} location={{ content: <div>map</div> }} />);
    for (const name of ["proof", "location", "details"] as const) {
      expect(heading(EVENT_SECTIONS[name].title)).toBeInTheDocument();
    }
  });

  it("turns a flagged section's eyebrow red", () => {
    render(<EventLayout {...slots} details={{ ...slots.details, invalid: true }} />);
    expect(heading("Details")).toHaveClass(FORM_INVALID_LABEL);
    expect(heading("Proof")).not.toHaveClass(FORM_INVALID_LABEL);
  });

  it("sets an aside beside the eyebrow, out of the heading's name", () => {
    render(<EventLayout {...slots} proof={{ ...slots.proof, aside: <a href="/guide">Guide</a> }} />);
    expect(screen.getByRole("link", { name: "Guide" })).toBeInTheDocument();
    expect(heading("Proof").textContent).toBe("Proof");
  });

  it("renders the columns inside the form it is given", () => {
    const { container } = render(<EventLayout {...slots} form={{ id: "f" }} />);
    expect(container.querySelector("form#f")).toHaveTextContent("details card");
  });
});
