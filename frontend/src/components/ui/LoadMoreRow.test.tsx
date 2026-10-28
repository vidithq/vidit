import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoadMoreRow, SeeAllLink } from "./LoadMoreRow";

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
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(idle.loadMore).toHaveBeenCalledTimes(1);

    rerender(<LoadMoreRow walk={walk({ loadingMore: true })} />);
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();

    const failed = walk({
      error: { title: "Vidit does not respond", message: "Check your connection, then retry.", fields: {} },
    });
    rerender(<LoadMoreRow walk={failed} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Vidit does not respond");
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(failed.loadMore).toHaveBeenCalledTimes(1);
  });

  it("keeps Show more under a refused page, which a Retry would only repeat", () => {
    const refused = walk({ error: { title: null, message: "Not found.", fields: {} } });
    render(<LoadMoreRow walk={refused} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Not found.");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(refused.loadMore).toHaveBeenCalledTimes(1);
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

describe("SeeAllLink", () => {
  it("links a preview to its whole list", () => {
    render(<SeeAllLink href="/search?type=event&author=ana" />);

    const link = screen.getByRole("link", { name: "See all" });
    expect(link).toHaveAttribute("href", "/search?type=event&author=ana");
  });
});
