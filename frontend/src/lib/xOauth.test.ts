import { describe, expect, it } from "vitest";

import { xErrorMessage } from "./xOauth";

describe("xErrorMessage", () => {
  it("returns null when there is no code", () => {
    expect(xErrorMessage(null)).toBeNull();
  });

  it("maps known callback error codes to human copy", () => {
    expect(xErrorMessage("x_handle_conflict")).toBe(
      "That X handle is already linked to another account."
    );
    expect(xErrorMessage("oauth_refused")).toBe("X sign-in was cancelled.");
    expect(xErrorMessage("x_handle_already_set")).toBe(
      "Your account is already linked to a different X handle."
    );
  });

  it("falls back to a generic message for an unknown code", () => {
    expect(xErrorMessage("something_new")).toBe(
      "X sign-in didn't complete. Please try again."
    );
  });
});
