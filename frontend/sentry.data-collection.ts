// What the Sentry SDK may attach to events, shared by the client, server, and
// edge inits. Mirrors the backend `send_default_pii=False`: no user info, no
// cookies, no bodies, and IP or forwarding headers and query params filtered
// out. These are the values the @sentry/nextjs 11 migration guide gives for
// the v10 `sendDefaultPii: false` behavior; leaving `dataCollection` unset
// collects all of these categories by default.
import type { init } from "@sentry/nextjs";

type DataCollection = NonNullable<
  NonNullable<Parameters<typeof init>[0]>["dataCollection"]
>;

const IP_KEYS_DENY = { deny: ["forwarded", "-ip", "remote-", "via", "-user"] };

export const SENTRY_DATA_COLLECTION: DataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: IP_KEYS_DENY, response: IP_KEYS_DENY },
  httpBodies: [],
  urlQueryParams: IP_KEYS_DENY,
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  graphQL: { document: false, variables: false },
};
