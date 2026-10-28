import { describe, expect, it } from "vitest";

import { NO_ANSWER, errorText, readError, readResponse } from "./errors";

const refused = (...items: object[]) => readResponse(422, { detail: items }, null).error;

describe("readResponse", () => {
  it("shows a message the backend wrote for people as written", () => {
    expect(readResponse(404, { detail: "Event not found" }, null)).toEqual({
      error: { title: null, message: "Event not found", fields: {} },
      code: null,
    });
    expect(
      readResponse(400, { detail: { code: "invalid_file", message: "Images and videos only." } }, null),
    ).toEqual({
      error: { title: null, message: "Images and videos only.", fields: {} },
      code: "invalid_file",
    });
  });

  it.each([500, 502, 503])("reads a %i with no typed message as a fault on Vidit's side", (status) => {
    const { error } = readResponse(status, null, null);
    expect(error.title).toBe("Vidit hit a problem");
    expect(error.message).toBe("Retry in a moment.");
    expect(readResponse(status, { detail: "Internal Server Error" }, null).error.title).toBe(
      "Vidit hit a problem",
    );
  });

  it("keeps a 5xx that carries a typed message", () => {
    const body = { detail: { code: "upstream_busy", message: "The post's host is busy." } };
    expect(readResponse(503, body, null).error).toEqual({
      title: null,
      message: "The post's host is busy.",
      fields: {},
    });
  });

  it("words a body-less 404 and 403", () => {
    expect(readResponse(404, null, null).error.message).toBe("Not found. It may have been deleted.");
    expect(readResponse(403, null, null).error.message).toBe("You cannot do this.");
    expect(readResponse(418, null, null).error.message).toBe("Something went wrong.");
  });

  it.each([
    [null, "Too many attempts. Try again in a few minutes."],
    [1, "Too many attempts. Try again in a second."],
    [30, "Too many attempts. Try again in 30 seconds."],
    [60, "Too many attempts. Try again in a minute."],
    [61, "Too many attempts. Try again in 2 minutes."],
  ])("reads a rate limit with Retry-After %s as a wait", (retryAfter, message) => {
    const body = { detail: { code: "rate_limited", message: "Rate limit exceeded. Try again later." } };
    expect(readResponse(429, body, retryAfter)).toEqual({
      error: { title: null, message, fields: {} },
      code: "rate_limited",
    });
  });

  it("names the hourly reading limit apart from a throttle", () => {
    const body = { detail: { code: "read_quota_exceeded", message: "Hourly read quota exceeded." } };
    expect(readResponse(429, body, 600).error.message).toBe(
      "You reached the hourly reading limit. Try again in 10 minutes.",
    );
  });
});

describe("a refused body", () => {
  it("never shows Pydantic's own wording, and keys each refusal by its field", () => {
    const error = refused({
      loc: ["body", "x_handle"],
      msg: "Value error, 15 characters at most: letters, digits and _",
      type: "value_error",
    });
    expect(error).toEqual({
      title: null,
      message: "X handle: 15 characters at most: letters, digits and _.",
      fields: { x_handle: "15 characters at most: letters, digits and _." },
    });
  });

  it.each([
    [{ type: "missing", msg: "Field required" }, "Required."],
    [{ type: "string_too_short", msg: "x", ctx: { min_length: 1 } }, "Required."],
    [{ type: "string_too_short", msg: "x", ctx: { min_length: 3 } }, "3 characters at least."],
    [{ type: "string_too_long", msg: "String should have at most 280 characters", ctx: { max_length: 280 } }, "280 characters at most."],
    [{ type: "too_long", msg: "x", ctx: { max_length: 5 } }, "5 items at most."],
    [{ type: "greater_than_equal", msg: "x", ctx: { ge: -90 } }, "-90 or more."],
    [{ type: "less_than_equal", msg: "x", ctx: { le: 90 } }, "90 at most."],
    [{ type: "float_parsing", msg: "Input should be a valid number" }, "Must be a number."],
    [{ type: "url_parsing", msg: "Input should be a valid URL" }, "Not a valid link."],
    [{ type: "literal_error", msg: "Input should be 'a' or 'b'" }, "Pick one of the offered values."],
    [
      { type: "value_error", msg: "value is not a valid email address: An email address must have an @-sign." },
      "Not a valid email address.",
    ],
    [{ type: "uuid_parsing", msg: "Input should be a valid UUID" }, "This value is not accepted."],
  ])("reads %o as %s", (item, text) => {
    expect(refused({ loc: ["body", "field"], ...item }).fields).toEqual({ field: text });
  });

  it("names the field past a list index, and none for the body itself", () => {
    expect(refused({ loc: ["body", "links", 2], type: "url_parsing", msg: "x" }).fields).toEqual({
      links: "Not a valid link.",
    });
    expect(
      refused({ loc: ["body"], type: "value_error", msg: "Value error, send exactly one of a or b" }),
    ).toEqual({ title: null, message: "Send exactly one of a or b.", fields: {} });
  });

  it("leads with the first refusal and keeps every field", () => {
    const error = refused(
      { loc: ["body", "display_name"], type: "missing", msg: "Field required" },
      { loc: ["body", "bio"], type: "value_error", msg: "Value error, 500 characters at most" },
    );
    expect(error.message).toBe("Display name: Required.");
    expect(error.fields).toEqual({ display_name: "Required.", bio: "500 characters at most." });
  });
});

describe("readError and errorText", () => {
  it("reads a non-Error throw as the fallback, and another error by its message", () => {
    expect(readError("boom", "Could not save.")).toEqual({
      title: null,
      message: "Could not save.",
      fields: {},
    });
    expect(readError(new Error("That zip isn't an X data export."))).toEqual({
      title: null,
      message: "That zip isn't an X data export.",
      fields: {},
    });
    expect(readError(new Error("")).message).toBe("Something went wrong.");
  });

  it("joins a title and its detail into one sentence", () => {
    expect(errorText(NO_ANSWER)).toBe("Vidit does not respond. Check your connection, then retry.");
    expect(errorText({ title: null, message: "Required.", fields: {} })).toBe("Required.");
  });
});
