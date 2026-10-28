"use client";

import { sourcesBlockWrite } from "@/components/sources/SourcesField";
import { useMutation } from "@/hooks/useMutation";
import type { MissingField } from "@/lib/events";
import { sourceWriteError } from "@/lib/sources";

import type { EventFormState } from "./EventFormFields";
import { usePublishAction, type PublishAction } from "./PublishActions";

/** What a failed write prints when the server names no reason, one sentence per write kind. */
export const WRITE_FALLBACK = {
  publish: "Couldn't publish.",
  version: "Couldn't save this version.",
  saveRequest: "Couldn't save this request.",
} as const;

/** Why a request write with Linked sites holds. */
export const REQUEST_SITE_LINKS =
  "A request links to no site. Remove the linked sites, or publish a geolocation.";

/** One write of an event form, as `PublishActions` and `writeGroup` read it. */
interface EventWrite {
  action: PublishAction;
  busy: boolean;
  error: string | null;
  /** What the write's floor still misses, live: the count on its button. */
  missing: MissingField[];
  reset: () => void;
}

/**
 * One write of an event form: the mutation, the gate every click runs, and the click's arming
 * (`usePublishAction`). The gate runs in one order on every form:
 *
 * 1. Clear the banner and the red outlines (`resetAll`, else this write's own).
 * 2. A publish floor waits for the conflict options: before they load, a missing conflict cannot
 *    be told from one still loading, so the banner says which.
 * 3. The floor: every missing field turns red at once.
 * 4. A request write with Linked sites: only a published event links to a site.
 * 5. The sources' hold (`sourcesBlockWrite`): a running upload, or a pasted snapshot that cannot
 *    be one. An upload usually clears itself, so it never hides a field the reader has to fill.
 * 6. `extraCheck`, the surface's own refusal.
 *
 * A refusal at 2, 4, 5 or 6 prints in the banner.
 */
export function useEventWrite<R>(
  form: EventFormState,
  {
    floor,
    post,
    fallback,
    onSuccess,
    onError,
    confirm,
    ask,
    extraCheck,
    resetAll,
  }: {
    /** `publish` gates on the geolocation floor, `request` on the request floor. */
    floor: "publish" | "request";
    post: () => Promise<R>;
    /** One of `WRITE_FALLBACK`. */
    fallback: string;
    onSuccess: (result: R) => void;
    /** Maps a refusal the source errors do not cover; `undefined` falls through to them. */
    onError?: (err: unknown) => string | undefined;
    /** The armed sentence: set, a first click arms (see `usePublishAction`). */
    confirm?: string;
    /** A first click opens the button's panel (see `usePublishAction`). */
    ask?: boolean;
    /** The last gate: a message holds the write and prints in the banner. */
    extraCheck?: () => string | null;
    /** Clears every write the form shows (`writeGroup`'s reset), so one banner shows at a time. */
    resetAll?: () => void;
  },
): EventWrite {
  const mutation = useMutation(post, {
    fallback,
    onError: (err) => onError?.(err) ?? sourceWriteError(err),
    onSuccess,
  });
  const missing = floor === "publish" ? form.publishMissing : form.requestMissing;

  const hold = (message: string) => {
    mutation.setError(message);
    return false;
  };

  const action = usePublishAction({
    check: () => {
      (resetAll ?? mutation.reset)();
      form.clearIncomplete();
      if (floor === "publish" && form.taxonomy.blockedMessage !== null) {
        return hold(form.taxonomy.blockedMessage);
      }
      if (missing.length) {
        form.flagIncomplete(missing);
        return false;
      }
      if (floor === "request" && form.siteLinks.links.length > 0) {
        return hold(REQUEST_SITE_LINKS);
      }
      const blocked = sourcesBlockWrite(form.sources) ?? extraCheck?.() ?? null;
      return blocked === null || hold(blocked);
    },
    write: () => void mutation.run(),
    confirm,
    ask,
  });

  return { action, busy: mutation.loading, error: mutation.error, missing, reset: mutation.reset };
}

/** The writes one form shows, read together: the one banner, whether any runs, and the reset
 *  each click starts with. */
export function writeGroup(...writes: EventWrite[]) {
  return {
    error: writes.find((w) => w.error !== null)?.error ?? null,
    busy: writes.some((w) => w.busy),
    reset: () => {
      for (const w of writes) w.reset();
    },
  };
}
