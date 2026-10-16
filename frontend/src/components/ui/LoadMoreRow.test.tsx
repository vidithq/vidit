import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoadMoreRow } from "./LoadMoreRow";

const walk = (extra: Partial<Parameters<typeof LoadMoreRow>[0]["walk"]> = {}) => ({
  hasMore: true,
  loadingMore: false,
  loadMore: vi.fn(),
  error: null,
  ...extra,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LoadMoreRow", () => {
  it("renders nothing once the walk ends", () => {
    const { container } = render(<LoadMoreRow walk={walk({ hasMore: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("loads on click, spins while loading, and retries a failed page", () => {
    const idle = walk();
    const { rerender } = render(<LoadMoreRow walk={idle} />);
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(idle.loadMore).toHaveBeenCalledTimes(1);

    rerender(<LoadMoreRow walk={walk({ loadingMore: true })} />);
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();

    const failed = walk({ error: "API error 500" });
    rerender(<LoadMoreRow walk={failed} />);
    expect(screen.getByText("API error 500")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(failed.loadMore).toHaveBeenCalledTimes(1);
  });

  it("observes the row only when infinite", () => {
    const observe = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe = observe;
        disconnect() {}
      },
    );
    const { rerender } = render(<LoadMoreRow walk={walk()} />);
    expect(observe).not.toHaveBeenCalled();
    rerender(<LoadMoreRow walk={walk()} infinite />);
    expect(observe).toHaveBeenCalledTimes(1);
  });
});
