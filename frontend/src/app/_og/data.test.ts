import type { LookupAddress } from "node:dns";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ogImageDataUri, ogFetch } from "./data";

/** A 4×4 opaque picture, raw, for `sharp` to encode in the format a test needs. */
const SOLID = sharp({ create: { width: 4, height: 4, channels: 3, background: "#f97316" } });

// The image leg reads through `undici`'s own `fetch` with the guarded `Agent` as dispatcher, so
// the module is mocked, not the global `fetch` (a dispatcher is only honoured by the undici
// that built it). The `Agent` stub records its options, reaching the guard's `lookup`.
const undici = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  agentOptions: [] as { connect: { lookup: LookupFn } }[],
}));

type LookupFn = (
  hostname: string,
  options: { all?: boolean },
  callback: (
    err: Error | null,
    address: string | LookupAddress[],
    family?: number | undefined,
  ) => void,
) => void;

vi.mock("undici", () => ({
  fetch: undici.fetchMock,
  Agent: class {
    constructor(options: { connect: { lookup: LookupFn } }) {
      undici.agentOptions.push(options);
    }
  },
}));

/** The `connect.lookup` the image dispatcher was built with. */
const imageLookup: LookupFn = (hostname, options, callback) =>
  undici.agentOptions[0].connect.lookup(hostname, options, callback);

const undiciFetchMock = undici.fetchMock;
/** The platform `fetch`, which only `ogFetch` reads through. */
const fetchMock = vi.fn();
const dnsLookupMock = vi.hoisted(() => vi.fn());

// `node:dns` is CJS: both import paths carry the stub or the guard resolves for real.
vi.mock("node:dns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns")>();
  return { ...actual, default: { ...actual, lookup: dnsLookupMock }, lookup: dnsLookupMock };
});

/** The rejection log the image leg writes; silenced. */
const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

beforeEach(() => {
  fetchMock.mockReset();
  undiciFetchMock.mockReset();
  dnsLookupMock.mockReset();
  warn.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Answer every `dnsLookup` call with `addresses`. */
function resolvesTo(addresses: LookupAddress[]) {
  dnsLookupMock.mockImplementation(
    (
      _hostname: string,
      _options: unknown,
      callback: (err: Error | null, addresses: LookupAddress[]) => void,
    ) => callback(null, addresses),
  );
}

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

/** The same, for the image leg's undici `fetch`. */
function imageResolveWith(res: ReturnType<typeof response>) {
  undiciFetchMock.mockResolvedValue(res as unknown as Response);
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
    imageResolveWith(response({ contentType: "image/png", chunks: [new Uint8Array([1, 2, 3])] }));
    expect(await ogImageDataUri("https://cdn.example.com/a.png")).toBe(
      "data:image/png;base64,AQID",
    );
  });

  it("reads through undici's own fetch, not the platform one", async () => {
    // The dispatcher carries the connection guard and only the undici that built it honours it;
    // on a runtime whose global `fetch` differs, handing it this `Agent` throws and the card
    // loses its picture.
    imageResolveWith(response({ contentType: "image/png", chunks: [new Uint8Array([1])] }));
    await ogImageDataUri("https://cdn.example.com/a.png");
    expect(undiciFetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never opens a connection to a host the URL guard rejects", async () => {
    expect(await ogImageDataUri("https://localhost./x.png")).toBeNull();
    expect(await ogImageDataUri("http://cdn.example.com/a.png")).toBeNull();
    expect(await ogImageDataUri(null)).toBeNull();
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  it("connects through the address-guarded dispatcher, following no redirect", async () => {
    imageResolveWith(response({ contentType: "image/png", chunks: [new Uint8Array([1])] }));
    await ogImageDataUri("https://cdn.example.com/a.png");
    const init = undiciFetchMock.mock.calls[0][1] as { dispatcher?: unknown; redirect?: string };
    expect(init.dispatcher).toBeDefined();
    expect(init.redirect).toBe("error");
  });

  it.each([
    ["image/webp", "webp"],
    ["image/gif", "gif"],
  ] as const)("re-encodes a %s avatar as a PNG the rasteriser draws", async (type, format) => {
    // resvg draws nothing for a GIF or WebP data URI, so it arrives as a PNG of the same picture.
    const picture = await SOLID.clone().toFormat(format).toBuffer();
    imageResolveWith(response({ contentType: type, chunks: [new Uint8Array(picture)] }));
    const uri = await ogImageDataUri(`https://pbs.example.com/a.${format}`);
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
    imageResolveWith(response({ contentType: "image/png", chunks: [new Uint8Array(big)] }));
    const uri = await ogImageDataUri("https://cdn.example.com/big.png");
    const meta = await sharp(Buffer.from(uri!.split(",")[1], "base64")).metadata();
    expect(meta).toMatchObject({ format: "png", width: 1200, height: 1200 });
  });

  it("hands the caller its fallback on a body the type promised but no decoder reads", async () => {
    imageResolveWith(response({ contentType: "image/webp", chunks: [new Uint8Array([1, 2, 3])] }));
    expect(await ogImageDataUri("https://cdn.example.com/a.webp")).toBeNull();
    expect(String(warn.mock.calls[0][0])).toContain("og image skipped");
  });

  it("hands the caller its fallback on a type it cannot decode", async () => {
    imageResolveWith(response({ contentType: "text/html", chunks: [new Uint8Array([1, 2, 3])] }));
    expect(await ogImageDataUri("https://cdn.example.com/a.html")).toBeNull();
  });

  it("reads the API's own origin, the local storage backend, without the public-host guards", async () => {
    // `NEXT_PUBLIC_API_URL` is `https://api.invalid` under test; in development the API is
    // `http://localhost:8000`, which the URL guard and the address guard both refuse.
    imageResolveWith(response({ contentType: "image/jpeg", chunks: [new Uint8Array([1, 2, 3])] }));
    expect(await ogImageDataUri("https://api.invalid/local-storage/avatars/a.jpg")).toBe(
      "data:image/jpeg;base64,AQID",
    );
    const init = undiciFetchMock.mock.calls[0][1] as { dispatcher?: unknown };
    expect(init.dispatcher).toBeUndefined();
  });

  it("refuses a declared length over the ceiling before reading the body", async () => {
    const res = imageResolveWith(
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
    const res = imageResolveWith(
      response({
        contentType: "image/png",
        chunks: Array.from({ length: 9 }, () => new Uint8Array(1024 * 1024)),
      }),
    );
    expect(await ogImageDataUri("https://cdn.example.com/big.png")).toBeNull();
    expect(res.cancelled).toBe(true);
  });

  it("hands the caller its fallback on an empty body", async () => {
    imageResolveWith(response({ contentType: "image/png", chunks: [] }));
    expect(await ogImageDataUri("https://cdn.example.com/empty.png")).toBeNull();
  });

  it("hands the caller its fallback when the host answers a redirect", async () => {
    // `redirect: "error"` makes undici reject rather than follow a bounce onto
    // another host.
    undiciFetchMock.mockRejectedValue(new TypeError("unexpected redirect"));
    expect(await ogImageDataUri("https://cdn.example.com/a.png")).toBeNull();
  });

  it("hands the caller its fallback when the host runs out the budget", async () => {
    undiciFetchMock.mockRejectedValue(
      new DOMException("The operation was aborted", "TimeoutError"),
    );
    expect(await ogImageDataUri("https://cdn.example.com/slow.png")).toBeNull();
  });

  it("hands the caller its fallback on a non-2xx", async () => {
    imageResolveWith(response({ status: 403, contentType: "image/png" }));
    expect(await ogImageDataUri("https://cdn.example.com/a.png")).toBeNull();
  });
});

describe("the image warning", () => {
  it("names the reason and the target once per rejection", async () => {
    imageResolveWith(response({ status: 403, contentType: "image/png" }));
    await ogImageDataUri("https://cdn.example.com/a.png?sig=secret");
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain("status 403");
    expect(line).toContain("cdn.example.com/a.png");
    // A query string can carry a signature, so the line stops at the path.
    expect(line).not.toContain("secret");
  });

  it("names the URL guard when no connection is opened", async () => {
    await ogImageDataUri("http://cdn.example.com/a.png");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("rejected by the URL guard");
  });

  it("names the thrown error on a timeout", async () => {
    undiciFetchMock.mockRejectedValue(
      new DOMException("The operation was aborted", "TimeoutError"),
    );
    await ogImageDataUri("https://cdn.example.com/slow.png");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("The operation was aborted");
  });

  it("names the undecodable type", async () => {
    imageResolveWith(response({ contentType: "image/svg+xml", chunks: [new Uint8Array([1])] }));
    await ogImageDataUri("https://cdn.example.com/a.svg");
    expect(String(warn.mock.calls[0][0])).toContain("image/svg+xml");
  });

  it("names the byte cap when the body passes it mid-stream", async () => {
    imageResolveWith(
      response({
        contentType: "image/png",
        chunks: [new Uint8Array(8 * 1024 * 1024), new Uint8Array(1)],
      }),
    );
    await ogImageDataUri("https://cdn.example.com/big.png");
    expect(String(warn.mock.calls[0][0])).toContain("body over the");
  });
});

describe("the image connection guard's lookup", () => {
  const v4 = { address: "151.101.120.159", family: 4 };
  const v6 = { address: "2a04:4e42:1d::159", family: 6 };

  /** Run the guard's `lookup` and hand back what it called back with. */
  function lookup(options: { all?: boolean }) {
    return new Promise<{ err: Error | null; address: string | LookupAddress[]; family?: number }>(
      (resolve) => {
        imageLookup("cdn.example.com", options, (err, address, family) =>
          resolve({ err, address, family }),
        );
      },
    );
  }

  it("hands back an IPv4 address when the runtime asks for one", async () => {
    // A runtime without IPv6 egress can't reach the `2a04:` entry, so answering with the first
    // address costs the card its picture.
    resolvesTo([v6, v4]);
    expect(await lookup({})).toEqual({ err: null, address: v4.address, family: 4 });
  });

  it("keeps the whole answer when the runtime asks for all of it, IPv4 first", async () => {
    resolvesTo([v6, v4]);
    expect(await lookup({ all: true })).toMatchObject({ err: null, address: [v4, v6] });
  });

  it("answers an IPv6-only name with its one address", async () => {
    resolvesTo([v6]);
    expect(await lookup({})).toEqual({ err: null, address: v6.address, family: 6 });
  });

  it("rejects the whole answer when any address is private", async () => {
    resolvesTo([v4, { address: "169.254.169.254", family: 4 }]);
    const { err } = await lookup({ all: true });
    expect(err?.message).toContain("does not resolve to a public address");
  });
});
