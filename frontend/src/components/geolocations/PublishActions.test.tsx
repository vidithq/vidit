import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MissingField } from "@/lib/events";

import { PublishActions, usePublishAction } from "./PublishActions";

const TITLE: MissingField = { key: "title", label: "Title" };

function Host({
  missing = [],
  confirm,
  check = () => true,
  write,
  error = null,
}: {
  missing?: MissingField[];
  confirm?: string;
  check?: () => boolean;
  write: () => void;
  error?: string | null;
}) {
  const action = usePublishAction({ check, write, confirm });
  return (
    <PublishActions
      disabled={false}
      error={error}
      help="action_publish"
      buttons={[
        {
          action,
          label: "Publish geolocation",
          busyLabel: "Publishing…",
          busy: false,
          variant: "primary",
          icon: <svg data-testid="icon" />,
          missing,
        },
      ]}
    />
  );
}

describe("PublishActions", () => {
  it("arms on the first click and writes on the second", () => {
    const write = vi.fn();
    render(<Host write={write} confirm="Click again to publish." />);
    const button = screen.getByRole("button", { name: "Publish geolocation" });

    fireEvent.click(button);
    expect(write).not.toHaveBeenCalled();
    expect(button).toHaveAccessibleName("Confirm");
    expect(screen.getByRole("status")).toHaveTextContent("Click again to publish.");

    fireEvent.click(button);
    expect(write).toHaveBeenCalledTimes(1);
    expect(button).toHaveAccessibleName("Publish geolocation");
  });

  it("writes on the first click without a confirm", () => {
    const write = vi.fn();
    render(<Host write={write} />);
    fireEvent.click(screen.getByRole("button", { name: "Publish geolocation" }));
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("neither arms nor writes while a check holds the write", () => {
    const write = vi.fn();
    render(<Host write={write} check={() => false} confirm="Click again to publish." />);
    const button = screen.getByRole("button", { name: "Publish geolocation" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(write).not.toHaveBeenCalled();
    expect(button).toHaveAccessibleName("Publish geolocation");
  });

  it("counts what the write misses and dims the button while short", () => {
    render(<Host write={vi.fn()} missing={[TITLE]} />);
    const button = screen.getByRole("button", { name: "Publish geolocation" });
    expect(button).toHaveAccessibleDescription("1 missing: Title");
    expect(button.className).toContain("opacity-60");
  });

  it("holds the line in one landmark, the icon from lg up, the banner as an alert", () => {
    render(<Host write={vi.fn()} error="Couldn't publish." />);
    const actions = screen.getByRole("complementary", { name: "Actions" });
    expect(screen.getByTestId("icon").parentElement!.className).toContain("max-lg:hidden");
    expect(screen.getByRole("button", { name: "What does Publish do?" })).toBeInTheDocument();
    expect(actions).toContainElement(screen.getByRole("alert"));
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't publish.");
  });
});
