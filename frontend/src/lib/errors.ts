/** What a failed request says to a reader. `title` marks a fault the reader did not cause (no
 *  answer, a server fault): the notice leads with it and offers Retry. `fields` holds a refused
 *  body's field messages, keyed by the field's name, for a form to show under each field. */
export interface ReadableError {
  title: string | null;
  message: string;
  fields: Record<string, string>;
}

export const NO_ANSWER: ReadableError = {
  title: "Vidit does not respond",
  message: "Check your connection, then retry.",
  fields: {},
};

const SERVER_FAULT: ReadableError = {
  title: "Vidit hit a problem",
  message: "Retry in a moment.",
  fields: {},
};

export const SOMETHING_WENT_WRONG = "Something went wrong.";

export function plainError(message: string): ReadableError {
  return { title: null, message, fields: {} };
}

/** The error as one sentence, for a surface that holds a single line. */
export function errorText(error: ReadableError): string {
  return error.title ? `${error.title}. ${error.message}` : error.message;
}

function waitText(retryAfter: number | null): string {
  if (retryAfter === null) return "in a few minutes";
  if (retryAfter < 60) return retryAfter === 1 ? "in a second" : `in ${retryAfter} seconds`;
  const minutes = Math.ceil(retryAfter / 60);
  return minutes === 1 ? "in a minute" : `in ${minutes} minutes`;
}

function rateLimited(code: string | null, retryAfter: number | null): ReadableError {
  const lead =
    code === "read_quota_exceeded" ? "You reached the hourly reading limit." : "Too many attempts.";
  return plainError(`${lead} Try again ${waitText(retryAfter)}.`);
}

interface ValidationItem {
  loc?: unknown;
  msg?: unknown;
  type?: unknown;
  ctx?: Record<string, unknown>;
}

function sentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const capital = trimmed[0].toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}

// Pydantic's own wording names types and regexes; only a validator's `value_error` is written
// for people, in the backend schemas.
function validationText(item: ValidationItem): string {
  const ctx = item.ctx ?? {};
  const msg = typeof item.msg === "string" ? item.msg : "";
  switch (item.type) {
    case "missing":
      return "Required.";
    case "string_too_short":
      return Number(ctx.min_length) <= 1 ? "Required." : `${ctx.min_length} characters at least.`;
    case "string_too_long":
      return `${ctx.max_length} characters at most.`;
    case "too_short":
      return `${ctx.min_length} items at least.`;
    case "too_long":
      return `${ctx.max_length} items at most.`;
    case "greater_than_equal":
      return `${ctx.ge} or more.`;
    case "greater_than":
      return `More than ${ctx.gt}.`;
    case "less_than_equal":
      return `${ctx.le} at most.`;
    case "less_than":
      return `Less than ${ctx.lt}.`;
    case "int_parsing":
    case "int_type":
    case "float_parsing":
    case "float_type":
      return "Must be a number.";
    case "url_parsing":
    case "url_scheme":
    case "url_type":
      return "Not a valid link.";
    case "literal_error":
    case "enum":
      return "Pick one of the offered values.";
    case "value_error":
      if (msg.startsWith("value is not a valid email address")) {
        return "Not a valid email address.";
      }
      return sentence(msg.replace(/^Value error, /, ""));
    default:
      return "This value is not accepted.";
  }
}

// The field a refusal names: the last name in `loc`, past list indexes; none for the body.
function fieldOf(loc: unknown): string | null {
  if (!Array.isArray(loc)) return null;
  for (let i = loc.length - 1; i > 0; i--) {
    if (typeof loc[i] === "string") return loc[i];
  }
  return null;
}

function fieldLabel(field: string): string {
  const words = field.replace(/_/g, " ");
  return words[0].toUpperCase() + words.slice(1);
}

function validationError(items: ValidationItem[]): ReadableError {
  const fields: Record<string, string> = {};
  let message: string | null = null;
  for (const item of items) {
    const text = validationText(item);
    const field = fieldOf(item.loc);
    if (field !== null && !(field in fields)) fields[field] = text;
    message ??= field === null ? text : `${fieldLabel(field)}: ${text}`;
  }
  return { title: null, message: message ?? "This value is not accepted.", fields };
}

function fallbackFor(status: number): ReadableError {
  if (status >= 500) return SERVER_FAULT;
  if (status === 404) return plainError("Not found. It may have been deleted.");
  if (status === 403) return plainError("You cannot do this.");
  return plainError(SOMETHING_WENT_WRONG);
}

/** A non-2xx answer as a reader reads it. FastAPI's `detail` comes in three shapes: a string
 *  (HTTPException), `[{loc, msg, type, ctx}]` (a refused body) and `{code, message}` (a typed
 *  error). A message the backend wrote for people shows as written; a 5xx with no typed message,
 *  a rate limit and a refused body read from the table above. */
export function readResponse(
  status: number,
  body: unknown,
  retryAfter: number | null,
): { error: ReadableError; code: string | null } {
  const detail =
    body && typeof body === "object" && "detail" in body
      ? (body as { detail: unknown }).detail
      : undefined;
  let code: string | null = null;
  let message: string | null = null;
  if (typeof detail === "string") {
    message = detail;
  } else if (Array.isArray(detail) && detail.length > 0) {
    return { error: validationError(detail as ValidationItem[]), code: null };
  } else if (detail && typeof detail === "object" && "code" in detail) {
    const typed = detail as { code: unknown; message: unknown };
    code = typeof typed.code === "string" ? typed.code : null;
    message = typeof typed.message === "string" ? typed.message : null;
  }
  if (status === 429) return { error: rateLimited(code, retryAfter), code };
  if (message === null || (status >= 500 && code === null)) {
    return { error: fallbackFor(status), code };
  }
  return { error: plainError(message), code };
}

/** A thrown value as a reader reads it: an `ApiError`'s `readable`, another error's message, or
 *  `fallback` for a non-Error throw. Duck-typed, since `ApiError` lives in `api.ts`, which
 *  imports this module. */
export function readError(err: unknown, fallback = SOMETHING_WENT_WRONG): ReadableError {
  if (!(err instanceof Error)) return plainError(fallback);
  return (err as { readable?: ReadableError }).readable ?? plainError(err.message || fallback);
}
