import { CSRF_HEADER, readCsrfToken } from "./auth";
import {
  NO_ANSWER,
  SOMETHING_WENT_WRONG,
  errorText,
  plainError,
  readError,
  readResponse,
  type ReadableError,
} from "./errors";
import { nextCursor } from "./pagination";
import { reportSessionRejected } from "./session";

const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL;
if (!configuredApiUrl) {
  throw new Error(
    "NEXT_PUBLIC_API_URL must be set at build time. " +
      "Set it in the build environment of your frontend host, " +
      ".env.local (local dev), or as a CI build env."
  );
}

/** Backend base URL including `/api/v1`; shared with the server-side readers (share cards)
 * so the env guard lives once. */
export const API_URL: string = configuredApiUrl;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// A 401 from these says nothing about a held session: a wrong password, or the session probe
// `AuthProvider` reads itself. Any other 401 means the session cookie no longer holds.
const SESSION_PROBES = new Set(["/auth/login", "/auth/me"]);

/** Thrown by `apiFetch` for any non-2xx, and for a request that gets no answer (`status` 0).
 * `status` separates a real auth failure (401/403) from a transient one (5xx, network), so a
 * backend hiccup doesn't bounce to `/login`. `code` is the backend's stable identifier for
 * errors worth branching on (e.g. `email_pending_confirmation`); `null` for plain string
 * `detail`s. `sessionRejected` marks a 401 the session notice already speaks for, so a form
 * shows no message of its own. `readable` is what the reader is told, and `message` is it as
 * one sentence. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly sessionRejected: boolean;
  readonly readable: ReadableError;
  constructor(
    message: string,
    status: number,
    code: string | null = null,
    sessionRejected = false,
    readable: ReadableError = plainError(message),
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.sessionRejected = sessionRejected;
    this.readable = readable;
  }
}

/** `readError` as one sentence. Pair with `useMutation`. */
export function errorMessage(err: unknown, fallback = SOMETHING_WENT_WRONG): string {
  return errorText(readError(err, fallback));
}

function retryAfterSeconds(res: Response): number | null {
  const value = Number(res.headers.get("Retry-After"));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** The one request path: CSRF on unsafe methods, credentials, and the error envelope as an
 * `ApiError`. Returns the raw `Response` so `apiFetchPage` can read `Link`. */
async function send(path: string, options?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  };

  if (!(options?.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const method = (options?.method ?? "GET").toUpperCase();
  if (!SAFE_METHODS.has(method)) {
    const csrf = readCsrfToken();
    if (csrf) {
      headers[CSRF_HEADER] = csrf;
    }
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      credentials: "include",
      headers,
    });
  } catch (err) {
    // A fetch rejects only on an abort or on no answer at all (offline, DNS, refused, CORS).
    if (options?.signal?.aborted) throw err;
    throw new ApiError(errorText(NO_ANSWER), 0, null, false, NO_ANSWER);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const { error, code } = readResponse(res.status, body, retryAfterSeconds(res));
    // A 403 is a refusal to a live session: only a 401 ends it.
    const sessionRejected =
      res.status === 401 && !SESSION_PROBES.has(path.split("?")[0]) && reportSessionRejected();
    throw new ApiError(errorText(error), res.status, code, sessionRejected, error);
  }
  return res;
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await send(path, options);

  if (res.status === 204) {
    return undefined as T;
  }
  return res.json();
}

/** One page of a capped list plus the cursor for the next (`Link: rel="next"`); `null` on
 * the last page. */
export async function apiFetchPage<T>(
  path: string,
  options?: RequestInit
): Promise<{ items: T; nextCursor: string | null }> {
  const res = await send(path, options);
  return {
    // Same 204 guard as `apiFetch`.
    items: (res.status === 204 ? undefined : await res.json()) as T,
    nextCursor: nextCursor(res.headers.get("Link")),
  };
}
