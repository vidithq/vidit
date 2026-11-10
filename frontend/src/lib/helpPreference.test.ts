import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearHelpHidden, getHelpHidden, getSavedHelpHidden, setHelpHidden } from "./helpPreference";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("help preference", () => {
  it("reads unset as shown and keeps the saved choice", () => {
    expect(getHelpHidden()).toBe(false);
    expect(getSavedHelpHidden()).toBeNull();

    setHelpHidden(true);
    expect(window.localStorage.getItem("vidit:help-hidden")).toBe("1");
    expect(getHelpHidden()).toBe(true);
    expect(getSavedHelpHidden()).toBe(true);

    clearHelpHidden();
    expect(getSavedHelpHidden()).toBeNull();
  });

  it("keeps the choice in memory when storage throws", () => {
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(blocked);

    expect(getHelpHidden()).toBe(false);
    setHelpHidden(true);
    expect(getHelpHidden()).toBe(true);
    clearHelpHidden();
    expect(getSavedHelpHidden()).toBeNull();
  });
});
