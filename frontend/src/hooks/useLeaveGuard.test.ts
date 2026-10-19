import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useLeaveGuard } from "./useLeaveGuard";

function fireBeforeUnload(): Event {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe("useLeaveGuard", () => {
  it("asks for confirmation while active", () => {
    renderHook(() => useLeaveGuard(true));
    expect(fireBeforeUnload().defaultPrevented).toBe(true);
  });

  it("lets the page go while inactive", () => {
    renderHook(() => useLeaveGuard(false));
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });

  it("drops the prompt once switched off", () => {
    const { rerender } = renderHook(({ active }) => useLeaveGuard(active), {
      initialProps: { active: true },
    });
    rerender({ active: false });
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });

  it("drops the prompt on unmount", () => {
    const { unmount } = renderHook(() => useLeaveGuard(true));
    unmount();
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });
});
