import { vi } from "vitest";

const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");

/** Stands in for `@/lib/api`: the real `ApiError` and `errorMessage`, with both request
 *  functions as spies. Mock it with `vi.mock("@/lib/api", () => import("@/test/apiStub"))` and
 *  import the spies from here. */
export const { API_URL, ApiError, errorMessage } = actual;
export const apiFetch = vi.fn();
export const apiFetchPage = vi.fn();
