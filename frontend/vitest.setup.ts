import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library's automatic between-test cleanup registers on a global
// `afterEach`, which only exists under vitest's `globals: true` — hook it
// explicitly so renders never leak across tests.
afterEach(cleanup);
