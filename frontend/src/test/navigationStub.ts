import { vi } from "vitest";

export const push = vi.fn();
export const replace = vi.fn();
export const back = vi.fn();

/** Stands in for `next/navigation` with a router of spies. Mock it with
 *  `vi.mock("next/navigation", () => import("@/test/navigationStub"))`. */
export const useRouter = () => ({ push, replace, back });
