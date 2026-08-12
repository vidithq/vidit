import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ogAvatarDataUri, ogFetch } from "./data";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Minimal stand-in for the parts of `Response` these readers touch. */
function response({
  status = 200,
  json,
  contentType,
  contentLength,
  chunks = [],
}: {
  status?: number;
  json?: unknown;
  contentType?: string;
  contentLength?: string;
  chunks?: Uint8Array[];
}) {
  const headers = new Map<string, string>();
  if (contentType !== undefined) headers.set("content-type", contentType);
  if (contentLength !== undefined) headers.set("content-length", contentLength);
  let next = 0;
  let cancelled = false;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    json: async () => json,
    body: {
      getReader: () => ({
        read: async () =>
          next < chunks.length
            ? { done: false, value: chunks[next++] }
            : { done: true, value: undefined },
        cancel: async () => {
          cancelled = true;
        },
      }),
    },
    /** Test-only: whether the reader was dropped before the body ran out. */
    get cancelled() {
      return cancelled;
    },
  };
}

function resolveWith(res: ReturnType<typeof response>) {
  fetchMock.mockResolvedValue(res as unknown as Response);
  return res;
}

describe("ogFetch", () => {
  it("returns the payload on a 200", async () => {
    resolveWith(response({ json: { username: "admin" } }));
    expect(await ogFetch("/users/admin")).toEqual({
      status: "ok",
      data: { username: "admin" },
    });
  });

  it("reads a 404 as a permanent miss", async () => {
    resolveWith(response({ status: 404 }));
    expect(await ogFetch("/users/nobody")).toEqual({ status: "missing" });
  });

  it("reads a 422 as a permanent miss, since a malformed id names no row", async () => {
    resolveWith(response({ status: 422 }));
    expect(await ogFetch("/events/not-a-uuid")).toEqual({ status: "missing" });
  });

  it("keeps a rate limit and a server error apart from a miss", async () => {
    resolveWith(response({ status: 429 }));
    expect(await ogFetch("/users/admin")).toEqual({ status: "failed" });
    resolveWith(response({ status: 503 }));
    expect(await ogFetch("/users/admin")).toEqual({ status: "failed" });
  });

  it("reads a timeout as a failure, not a miss", async () => {
    fetchMock.mockRejectedValue(new DOMException("The operation was aborted", "TimeoutError"));
    expect(await ogFetch("/users/admin")).toEqual({ status: "failed" });
  });

  it("reads an undecodable payload as a failure", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    } as unknown as Response);
    expect(await ogFetch("/users/admin")).toEqual({ status: "failed" });
  });
});

describe("ogAvatarDataUri", () => {
  it("inlines a decodable image as a data URI", async () => {
    resolveWith(response({ contentType: "image/png", chunks: [new Uint8Array([1, 2, 3])] }));
    expect(await ogAvatarDataUri("https://cdn.example.com/a.png")).toBe(
      "data:image/png;base64,AQID",
    );
  });

  it("never opens a connection to a host the URL guard rejects", async () => {
    expect(await ogAvatarDataUri("https://localhost./x.png")).toBeNull();
    expect(await ogAvatarDataUri("http://cdn.example.com/a.png")).toBeNull();
    expect(await ogAvatarDataUri(null)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("connects through the address-guarded dispatcher", async () => {
    resolveWith(response({ contentType: "image/png", chunks: [new Uint8Array([1])] }));
    await ogAvatarDataUri("https://cdn.example.com/a.png");
    const init = fetchMock.mock.calls[0][1] as { dispatcher?: unknown; redirect?: string };
    expect(init.dispatcher).toBeDefined();
    expect(init.redirect).toBe("error");
  });

  it("falls back to the monogram on a type Satori cannot decode", async () => {
    resolveWith(response({ contentType: "image/webp", chunks: [new Uint8Array([1, 2, 3])] }));
    expect(await ogAvatarDataUri("https://cdn.example.com/a.webp")).toBeNull();
  });

  it("refuses a declared length over the ceiling before reading the body", async () => {
    const res = resolveWith(
      response({
        contentType: "image/png",
        contentLength: String(4 * 1024 * 1024),
        chunks: [new Uint8Array([1, 2, 3])],
      }),
    );
    expect(await ogAvatarDataUri("https://cdn.example.com/big.png")).toBeNull();
    expect(res.cancelled).toBe(false);
  });

  it("drops a body that passes the ceiling while it streams", async () => {
    // No content-length, so only the running budget can catch it: three chunks
    // of 1 MB each against a 2 MB ceiling.
    const res = resolveWith(
      response({
        contentType: "image/png",
        chunks: [
          new Uint8Array(1024 * 1024),
          new Uint8Array(1024 * 1024),
          new Uint8Array(1024 * 1024),
        ],
      }),
    );
    expect(await ogAvatarDataUri("https://cdn.example.com/big.png")).toBeNull();
    expect(res.cancelled).toBe(true);
  });

  it("falls back to the monogram on an empty body", async () => {
    resolveWith(response({ contentType: "image/png", chunks: [] }));
    expect(await ogAvatarDataUri("https://cdn.example.com/empty.png")).toBeNull();
  });

  it("falls back to the monogram when the host answers a redirect", async () => {
    // `redirect: "error"` makes the platform reject rather than follow a bounce
    // onto another host.
    fetchMock.mockRejectedValue(new TypeError("unexpected redirect"));
    expect(await ogAvatarDataUri("https://cdn.example.com/a.png")).toBeNull();
  });

  it("falls back to the monogram when the host runs out the budget", async () => {
    fetchMock.mockRejectedValue(new DOMException("The operation was aborted", "TimeoutError"));
    expect(await ogAvatarDataUri("https://cdn.example.com/slow.png")).toBeNull();
  });

  it("falls back to the monogram on a non-2xx", async () => {
    resolveWith(response({ status: 403, contentType: "image/png" }));
    expect(await ogAvatarDataUri("https://cdn.example.com/a.png")).toBeNull();
  });
});
