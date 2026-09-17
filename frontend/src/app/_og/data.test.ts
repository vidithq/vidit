import type { LookupAddress } from "node:dns";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ogAvatarDataUri, ogFetch } from "./data";

// The avatar leg reads through the `undici` package's own `fetch` with the
// guarded `Agent` as its dispatcher, so the module is mocked rather than the
// global `fetch`: a dispatcher is only honoured by the undici that built it,
// and on a serverless runtime the global `fetch` is a different one. The
// `Agent` stub records its options, which is how the connection guard's
// `lookup` is reached below.
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

/** The `connect.lookup` the avatar dispatcher was built with. */
const avatarLookup: LookupFn = (hostname, options, callback) =>
  undici.agentOptions[0].connect.lookup(hostname, options, callback);

const undiciFetchMock = undici.fetchMock;
/** The platform `fetch`, which only `ogFetch` reads through. */
const fetchMock = vi.fn();
const dnsLookupMock = vi.hoisted(() => vi.fn());

// `node:dns` is CJS, so the named import resolves through the default export:
// both carry the stub or the guard resolves for real.
vi.mock("node:dns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns")>();
  return { ...actual, default: { ...actual, lookup: dnsLookupMock }, lookup: dnsLookupMock };
});

/** The rejection log the avatar leg writes; silenced so a run stays readable. */
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

/** The same, for the avatar leg's undici `fetch`. */
function avatarResolveWith(res: ReturnType<typeof response>) {
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

describe("ogAvatarDataUri", () => {
  it("inlines a decodable image as a data URI", async () => {
    avatarResolveWith(response({ contentType: "image/png", chunks: [new Uint8Array([1, 2, 3])] }));
    expect(await ogAvatarDataUri("https://cdn.example.com/a.png")).toBe(
      "data:image/png;base64,AQID",
    );
  });

  it("reads through undici's own fetch, not the platform one", async () => {
    // The dispatcher below carries the connection guard, and a dispatcher is
    // only honoured by the undici that built it. On a runtime whose global
    // `fetch` is a different undici, handing it this `Agent` throws and the
    // card silently loses its avatar.
    avatarResolveWith(response({ contentType: "image/png", chunks: [new Uint8Array([1])] }));
    await ogAvatarDataUri("https://cdn.example.com/a.png");
    expect(undiciFetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never opens a connection to a host the URL guard rejects", async () => {
    expect(await ogAvatarDataUri("https://localhost./x.png")).toBeNull();
    expect(await ogAvatarDataUri("http://cdn.example.com/a.png")).toBeNull();
    expect(await ogAvatarDataUri(null)).toBeNull();
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  it("connects through the address-guarded dispatcher, following no redirect", async () => {
    avatarResolveWith(response({ contentType: "image/png", chunks: [new Uint8Array([1])] }));
    await ogAvatarDataUri("https://cdn.example.com/a.png");
    const init = undiciFetchMock.mock.calls[0][1] as { dispatcher?: unknown; redirect?: string };
    expect(init.dispatcher).toBeDefined();
    expect(init.redirect).toBe("error");
  });

  it("falls back to the monogram on a type Satori cannot decode", async () => {
    avatarResolveWith(response({ contentType: "image/webp", chunks: [new Uint8Array([1, 2, 3])] }));
    expect(await ogAvatarDataUri("https://cdn.example.com/a.webp")).toBeNull();
  });

  it("refuses a declared length over the ceiling before reading the body", async () => {
    const res = avatarResolveWith(
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
    const res = avatarResolveWith(
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
    avatarResolveWith(response({ contentType: "image/png", chunks: [] }));
    expect(await ogAvatarDataUri("https://cdn.example.com/empty.png")).toBeNull();
  });

  it("falls back to the monogram when the host answers a redirect", async () => {
    // `redirect: "error"` makes undici reject rather than follow a bounce onto
    // another host.
    undiciFetchMock.mockRejectedValue(new TypeError("unexpected redirect"));
    expect(await ogAvatarDataUri("https://cdn.example.com/a.png")).toBeNull();
  });

  it("falls back to the monogram when the host runs out the budget", async () => {
    undiciFetchMock.mockRejectedValue(
      new DOMException("The operation was aborted", "TimeoutError"),
    );
    expect(await ogAvatarDataUri("https://cdn.example.com/slow.png")).toBeNull();
  });

  it("falls back to the monogram on a non-2xx", async () => {
    avatarResolveWith(response({ status: 403, contentType: "image/png" }));
    expect(await ogAvatarDataUri("https://cdn.example.com/a.png")).toBeNull();
  });
});

describe("the avatar warning", () => {
  it("names the reason and the target once per rejection", async () => {
    avatarResolveWith(response({ status: 403, contentType: "image/png" }));
    await ogAvatarDataUri("https://cdn.example.com/a.png?sig=secret");
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain("status 403");
    expect(line).toContain("cdn.example.com/a.png");
    // A query string can carry a signature, so the line stops at the path.
    expect(line).not.toContain("secret");
  });

  it("names the URL guard when no connection is opened", async () => {
    await ogAvatarDataUri("http://cdn.example.com/a.png");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("rejected by the URL guard");
  });

  it("names the thrown error on a timeout", async () => {
    undiciFetchMock.mockRejectedValue(
      new DOMException("The operation was aborted", "TimeoutError"),
    );
    await ogAvatarDataUri("https://cdn.example.com/slow.png");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("The operation was aborted");
  });

  it("names the undecodable type", async () => {
    avatarResolveWith(response({ contentType: "image/webp", chunks: [new Uint8Array([1])] }));
    await ogAvatarDataUri("https://cdn.example.com/a.webp");
    expect(String(warn.mock.calls[0][0])).toContain("image/webp");
  });

  it("names the byte cap when the body passes it mid-stream", async () => {
    avatarResolveWith(
      response({
        contentType: "image/png",
        chunks: [new Uint8Array(1024 * 1024), new Uint8Array(1024 * 1024 + 1)],
      }),
    );
    await ogAvatarDataUri("https://cdn.example.com/big.png");
    expect(String(warn.mock.calls[0][0])).toContain("body over the");
  });
});

describe("the avatar connection guard's lookup", () => {
  const v4 = { address: "151.101.120.159", family: 4 };
  const v6 = { address: "2a04:4e42:1d::159", family: 6 };

  /** Run the guard's `lookup` and hand back what it called back with. */
  function lookup(options: { all?: boolean }) {
    return new Promise<{ err: Error | null; address: string | LookupAddress[]; family?: number }>(
      (resolve) => {
        avatarLookup("cdn.example.com", options, (err, address, family) =>
          resolve({ err, address, family }),
        );
      },
    );
  }

  it("hands back an IPv4 address when the runtime asks for one", async () => {
    // A serverless runtime without IPv6 egress cannot reach the `2a04:` entry,
    // so answering with the first address costs the card its avatar.
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
