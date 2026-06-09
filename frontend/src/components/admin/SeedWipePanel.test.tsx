import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SeedWipePanel } from "./SeedWipePanel";

type SeedResult = { created: number };
type WipeResult = { deleted: number };

function renderPanel({
  seed = vi.fn(() => Promise.resolve<SeedResult>({ created: 7 })),
  wipe = vi.fn(() => Promise.resolve<WipeResult>({ deleted: 3 })),
}: {
  seed?: (count: number) => Promise<SeedResult>;
  wipe?: () => Promise<WipeResult>;
} = {}) {
  render(
    <SeedWipePanel
      title="Demo things"
      description="Synthetic things for the demo catalog."
      countInputId="thing-count"
      defaultCount={10}
      maxCount={500}
      seed={seed}
      seedLabel="Generate things"
      wipe={wipe}
      wipeLabel="Wipe all things"
      renderSeedSummary={(last) => <>seeded {last.created}</>}
      renderWipeSummary={(last) => <>wiped {last.deleted}</>}
    />
  );
  return { seed, wipe };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("SeedWipePanel", () => {
  it("seeds with the current count and renders the seed summary", async () => {
    const { seed } = renderPanel();
    fireEvent.change(screen.getByLabelText("Count"), {
      target: { value: "25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate things" }));
    expect(seed).toHaveBeenCalledTimes(1);
    expect(seed).toHaveBeenCalledWith(25);
    expect(await screen.findByText("seeded 7")).toBeInTheDocument();
  });

  it("clamps the count to [1, maxCount]", () => {
    renderPanel();
    const input = screen.getByLabelText("Count") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "9999" } });
    expect(input.value).toBe("500");
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("1");
  });

  it("requires a second click before wiping", async () => {
    const { wipe } = renderPanel();
    const button = screen.getByRole("button", { name: "Wipe all things" });
    fireEvent.click(button);
    expect(wipe).not.toHaveBeenCalled();
    expect(button).toHaveTextContent("Click again to confirm");
    fireEvent.click(button);
    expect(wipe).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("wiped 3")).toBeInTheDocument();
  });

  it("expires the confirm window after 3 seconds", () => {
    vi.useFakeTimers();
    const { wipe } = renderPanel();
    const button = screen.getByRole("button", { name: "Wipe all things" });
    fireEvent.click(button);
    expect(button).toHaveTextContent("Click again to confirm");
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(button).toHaveTextContent("Wipe all things");
    expect(wipe).not.toHaveBeenCalled();
  });

  it("shows the API message when seeding fails", async () => {
    renderPanel({
      seed: vi.fn(() => Promise.reject(new Error("demo pool is empty"))),
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate things" }));
    expect(await screen.findByText("demo pool is empty")).toBeInTheDocument();
  });

  it("falls back to a generic message on non-Error rejection", async () => {
    renderPanel({ wipe: vi.fn(() => Promise.reject("nope")) });
    const button = screen.getByRole("button", { name: "Wipe all things" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(await screen.findByText("Failed to wipe")).toBeInTheDocument();
  });
});
