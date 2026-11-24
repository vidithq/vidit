import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ogImageDataUri, ogFetch } from "./data";

/** A 4×4 opaque picture, raw, for `sharp` to encode in the format a test needs. */
const SOLID = sharp({ create: { width: 4, height: 4, channels: 3, background: "#f97316" } });

/** The platform `fetch`, which both the payload and the picture legs read through. */
const fetchMock = vi.fn();

/** The rejection log the image leg writes; silenced. */
const warn = vi.spyOn(console, "warn");

beforeEach(() => {
  warn.mockImplementation(() => {});
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NEXT_PUBLIC_MEDIA_HOST", "cdn.example.com");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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

describe("ogImageDataUri", () => {
  it("inlines a decodable image as a data URI", async () => {
    resolveWith(response({ contentType: "image/png", chunks: [new Uint8Array([1, 2, 3])] }));
    expect(await ogImageDataUri("https://cdn.example.com/a.png")).toBe(
      "data:image/png;base64,AQID",
    );
  });

  it("never fetches a host other than the media host", async () => {
    expect(await ogImageDataUri("https://other.example.com/a.png")).toBeNull();
    expect(await ogImageDataUri("https://cdn.example.com.attacker.net/a.png")).toBeNull();
    expect(await ogImageDataUri("https://cdn.example.com:8443/a.png")).toBeNull();
    expect(await ogImageDataUri("http://cdn.example.com/a.png")).toBeNull();
    expect(await ogImageDataUri("http://169.254.169.254/latest/meta-data/")).toBeNull();
    expect(await ogImageDataUri("not a url")).toBeNull();
    expect(await ogImageDataUri(null)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches no picture off the API origin when no media host is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_MEDIA_HOST", "");
    expect(await ogImageDataUri("https://cdn.example.com/a.png")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("follows no redirect, under a time budget, outside the data cache", async () => {
    resolveWith(response({ contentType: "image/png", chunks: [new Uint8Array([1])] }));
    await ogImageDataUri("https://cdn.example.com/a.png");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.cache).toBe("no-store");
  });

  it.each([
    ["image/webp", "webp"],
    ["image/gif", "gif"],
  ] as const)("re-encodes a %s avatar as a PNG the rasteriser draws", async (type, format) => {
    // resvg draws nothing for a GIF or WebP data URI, so it arrives as a PNG of the same picture.
    const picture = await SOLID.clone().toFormat(format).toBuffer();
    resolveWith(response({ contentType: type, chunks: [new Uint8Array(picture)] }));
    const uri = await ogImageDataUri(`https://cdn.example.com/a.${format}`);
    expect(uri?.startsWith("data:image/png;base64,")).toBe(true);
    const meta = await sharp(Buffer.from(uri!.split(",")[1], "base64")).metadata();
    expect(meta).toMatchObject({ format: "png", width: 4, height: 4 });
  });

  it("re-encodes a drawable picture too large to inline, at most card-sized", async () => {
    // Stored uncompressed, 1400 px square runs to about 6 MB: under the fetch cap, over inline.
    const big = await sharp({
      create: { width: 1400, height: 1400, channels: 3, background: "#f97316" },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    expect(big.byteLength).toBeGreaterThan(2 * 1024 * 1024);
    resolveWith(response({ contentType: "image/png", chunks: [new Uint8Array(big)] }));
    const uri = await ogImageDataUri("https://cdn.example.com/big.png");
    const meta = await sharp(Buffer.from(uri!.split(",")[1], "base64")).metadata();
    expect(meta).toMatchObject({ format: "png", width: 1200, height: 1200 });
  });

  it("hands the caller its fallback on a body the type promised but no decoder reads", async () => {
    resolveWith(response({ contentType: "image/webp", chunks: [new Uint8Array([1, 2, 3])] }));
    expect(await ogImageDataUri("https://cdn.example.com/a.webp")).toBeNull();
    expect(String(warn.mock.calls[0][0])).toContain("og image skipped");
  });

  it("hands the caller its fallback on a type it cannot decode", async () => {
    resolveWith(response({ contentType: "text/html", chunks: [new Uint8Array([1, 2, 3])] }));
    expect(await ogImageDataUri("https://cdn.example.com/a.html")).toBeNull();
  });

  it("reads the API's own origin, which serves the local storage backend", async () => {
    // `NEXT_PUBLIC_API_URL` is `https://api.invalid` under test; in development the API is
    // `http://localhost:8000` and no media host is set.
    vi.stubEnv("NEXT_PUBLIC_MEDIA_HOST", "");
    resolveWith(response({ contentType: "image/jpeg", chunks: [new Uint8Array([1, 2, 3])] }));
    expect(await ogImageDataUri("https://api.invalid/local-storage/avatars/a.jpg")).toBe(
      "data:image/jpeg;base64,AQID",
    );
  });

  it("refuses a declared length over the ceiling before reading the body", async () => {
    const res = resolveWith(
      response({
        contentType: "image/png",
        contentLength: String(9 * 1024 * 1024),
        chunks: [new Uint8Array([1, 2, 3])],
      }),
    );
    expect(await ogImageDataUri("https://cdn.example.com/big.png")).toBeNull();
    expect(res.cancelled).toBe(false);
  });

  it("drops a body that passes the ceiling while it streams", async () => {
    // No content-length, so only the running budget can catch it: nine chunks
    // of 1 MB each against an 8 MB ceiling.
    const res = resolveWith(
      response({
        contentType: "image/png",
        chunks: Array.from({ length: 9 }, () => new Uint8Array(1024 * 1024)),
      }),
    );
    expect(await ogImageDataUri("https://cdn.example.com/big.png")).toBeNull();
    expect(res.cancelled).toBe(true);
  });

  it("hands the caller its fallback on an empty body", async () => {
    resolveWith(response({ contentType: "image/png", chunks: [] }));
    expect(await ogImageDataUri("https://cdn.example.com/empty.png")).toBeNull();
  });

  it("hands the caller its fallback when the host answers a redirect", async () => {
    // `redirect: "error"` makes `fetch` reject rather than follow a bounce onto
    // another host.
    fetchMock.mockRejectedValue(new TypeError("unexpected redirect"));
    expect(await ogImageDataUri("https://cdn.example.com/a.png")).toBeNull();
  });

  it("hands the caller its fallback when the host runs out the budget", async () => {
    fetchMock.mockRejectedValue(
      new DOMException("The operation was aborted", "TimeoutError"),
    );
    expect(await ogImageDataUri("https://cdn.example.com/slow.png")).toBeNull();
  });

  it("hands the caller its fallback on a non-2xx", async () => {
    resolveWith(response({ status: 403, contentType: "image/png" }));
    expect(await ogImageDataUri("https://cdn.example.com/a.png")).toBeNull();
  });
});

describe("the image warning", () => {
  it("names the reason and the target once per rejection", async () => {
    resolveWith(response({ status: 403, contentType: "image/png" }));
    await ogImageDataUri("https://cdn.example.com/a.png?sig=secret");
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain("status 403");
    expect(line).toContain("cdn.example.com/a.png");
    // A query string can carry a signature, so the line stops at the path.
    expect(line).not.toContain("secret");
  });

  it("names the media host check when no request is sent", async () => {
    await ogImageDataUri("https://other.example.com/a.png");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("not on the media host");
  });

  it("names the thrown error on a timeout", async () => {
    fetchMock.mockRejectedValue(
      new DOMException("The operation was aborted", "TimeoutError"),
    );
    await ogImageDataUri("https://cdn.example.com/slow.png");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("The operation was aborted");
  });

  it("names the undecodable type", async () => {
    resolveWith(response({ contentType: "image/svg+xml", chunks: [new Uint8Array([1])] }));
    await ogImageDataUri("https://cdn.example.com/a.svg");
    expect(String(warn.mock.calls[0][0])).toContain("image/svg+xml");
  });

  it("names the byte cap when the body passes it mid-stream", async () => {
    resolveWith(
      response({
        contentType: "image/png",
        chunks: [new Uint8Array(8 * 1024 * 1024), new Uint8Array(1)],
      }),
    );
    await ogImageDataUri("https://cdn.example.com/big.png");
    expect(String(warn.mock.calls[0][0])).toContain("body over the");
  });
});
