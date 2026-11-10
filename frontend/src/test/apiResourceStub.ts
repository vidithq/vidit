import { vi } from "vitest";

/** Stands in for `@/hooks/useApiResource` with a spy each test answers. Mock it with
 *  `vi.mock("@/hooks/useApiResource", () => import("@/test/apiResourceStub"))`. */
export const useApiResource = vi.fn();
