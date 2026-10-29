import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useFirstLines } from "./useFirstLines";

/** Five 20px pills that wrap two to a line, laid out from each one's `data-top`. */
function Row() {
  const { ref, cut, height } = useFirstLines<HTMLDivElement>(2, "five");
  return (
    <div ref={ref} data-testid="row" style={{ maxHeight: height }}>
      {[0, 0, 28, 28, 56].map((top, i) => (
        <span key={i} data-top={top} className={i >= cut ? "invisible" : undefined}>
          pill {i}
        </span>
      ))}
    </div>
  );
}

afterEach(() => vi.restoreAllMocks());

describe("useFirstLines", () => {
  it("hides the children past two lines and caps the height at the second line's bottom", () => {
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
      return Number(this.dataset.top ?? 0);
    });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(20);
    render(<Row />);

    expect(screen.getByText("pill 3")).not.toHaveClass("invisible");
    expect(screen.getByText("pill 4")).toHaveClass("invisible");
    expect(screen.getByTestId("row")).toHaveStyle({ maxHeight: "48px" });
  });
});
