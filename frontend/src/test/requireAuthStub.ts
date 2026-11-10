import { ANA } from "./auth";

/** Stands in for `@/hooks/useRequireAuth`, signed in as `ANA`. Mock it with
 *  `vi.mock("@/hooks/useRequireAuth", () => import("@/test/requireAuthStub"))`. */
export const useRequireAuth = () => ({ user: ANA, loading: false });
