import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_THEME, applyTheme, getTheme, setTheme } from "./theme";

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("getTheme", () => {
  it("defaults to dark when nothing is stored", () => {
    expect(getTheme()).toBe(DEFAULT_THEME);
    expect(DEFAULT_THEME).toBe("dark");
  });

  it("returns a stored, valid theme id", () => {
    window.localStorage.setItem("vidit:theme", "light");
    expect(getTheme()).toBe("light");
  });

  it("ignores an unknown stored value and falls back to the default", () => {
    window.localStorage.setItem("vidit:theme", "sepia");
    expect(getTheme()).toBe(DEFAULT_THEME);
  });
});

describe("setTheme", () => {
  it("persists the choice, reflects it on <html>, and notifies listeners", () => {
    let notified = false;
    window.addEventListener("vidit:theme-changed", () => {
      notified = true;
    });

    setTheme("light");

    expect(window.localStorage.getItem("vidit:theme")).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(notified).toBe(true);
  });
});

describe("applyTheme", () => {
  it("sets the data-theme attribute", () => {
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
