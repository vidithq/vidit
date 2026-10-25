import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import type { MissingField } from "@/lib/events";
import { UPLOADS_RUNNING_MESSAGE, newSourceDraft, type SourceDraft } from "@/lib/sources";

import type { EventFormState } from "./EventFormFields";
import { WRITE_FALLBACK, useEventWrite, writeGroup } from "./useEventWrite";

const TITLE: MissingField = { key: "title", label: "Title" };
const CONFLICT: MissingField = { key: "conflict_tag", label: "Conflict" };
const LOADING = "Still loading the required Conflict options.";

/** A source whose file is still uploading: it holds the write. */
const uploading: SourceDraft = {
  ...newSourceDraft(),
  file: { state: "uploading", file: new File(["x"], "clip.mp4"), token: 1 },
};

/** The slice of the form state the controller reads, with what a test sets. */
function stubForm({
  publishMissing = [],
  requestMissing = [],
  blockedMessage = null,
  sources = [],
}: {
  publishMissing?: MissingField[];
  requestMissing?: MissingField[];
  blockedMessage?: string | null;
  sources?: SourceDraft[];
} = {}) {
  return {
    publishMissing,
    requestMissing,
    taxonomy: { blockedMessage },
    sources,
    flagIncomplete: vi.fn(),
    clearIncomplete: vi.fn(),
  } as unknown as EventFormState & {
    flagIncomplete: ReturnType<typeof vi.fn>;
    clearIncomplete: ReturnType<typeof vi.fn>;
  };
}

/** Render one write with no confirm, so `attempt` runs the gate and, when it passes, the post. */
function renderWrite(
  form: EventFormState,
  options: Partial<Parameters<typeof useEventWrite>[1]> = {},
) {
  const post = vi.fn().mockResolvedValue({ id: "e1" });
  const onSuccess = vi.fn();
  const hook = renderHook(() =>
    useEventWrite(form, {
      floor: "publish",
      post,
      fallback: WRITE_FALLBACK.publish,
      onSuccess,
      ...options,
    }),
  );
  const attempt = () => act(() => hook.result.current.action.attempt());
  return { hook, post, onSuccess, attempt };
}

describe("useEventWrite gate order", () => {
  it("waits for the conflict options before it flags the publish floor", () => {
    const form = stubForm({ publishMissing: [CONFLICT], blockedMessage: LOADING });
    const { hook, post, attempt } = renderWrite(form);
    attempt();
    expect(hook.result.current.error).toBe(LOADING);
    expect(form.flagIncomplete).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("ignores the conflict options on the request floor", () => {
    const form = stubForm({ requestMissing: [TITLE], blockedMessage: LOADING });
    const { hook, attempt } = renderWrite(form, { floor: "request" });
    attempt();
    expect(hook.result.current.error).toBeNull();
    expect(form.flagIncomplete).toHaveBeenCalledWith([TITLE]);
  });

  it("flags the floor before a running upload holds the write", () => {
    const form = stubForm({ publishMissing: [TITLE], sources: [uploading] });
    const { hook, post, attempt } = renderWrite(form);
    attempt();
    expect(form.flagIncomplete).toHaveBeenCalledWith([TITLE]);
    expect(hook.result.current.error).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it("holds a full floor while an upload runs", () => {
    const form = stubForm({ sources: [uploading] });
    const { hook, post, attempt } = renderWrite(form);
    attempt();
    expect(hook.result.current.error).toBe(UPLOADS_RUNNING_MESSAGE);
    expect(post).not.toHaveBeenCalled();
  });

  it("runs the surface's own check last", () => {
    const extraCheck = vi.fn(() => "Nothing changed since version 1.");
    const held = stubForm({ publishMissing: [TITLE] });
    renderWrite(held, { extraCheck }).attempt();
    expect(extraCheck).not.toHaveBeenCalled();

    const { hook, post, attempt } = renderWrite(stubForm(), { extraCheck });
    attempt();
    expect(hook.result.current.error).toBe("Nothing changed since version 1.");
    expect(post).not.toHaveBeenCalled();
  });

  it("posts once every gate passes, and clears the outlines first", async () => {
    const form = stubForm();
    const { post, onSuccess, attempt } = renderWrite(form);
    attempt();
    expect(form.clearIncomplete).toHaveBeenCalled();
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ id: "e1" }));
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe("useEventWrite errors", () => {
  it("maps the surface's refusals, then the source errors, then the fallback", async () => {
    const form = stubForm();
    const onError = (err: unknown) =>
      err instanceof ApiError && err.code === "nothing_changed" ? "Nothing changed." : undefined;
    const { hook, post, attempt } = renderWrite(form, { onError });

    post.mockRejectedValueOnce(new ApiError("", 409, "nothing_changed"));
    attempt();
    await waitFor(() => expect(hook.result.current.error).toBe("Nothing changed."));

    post.mockRejectedValueOnce("offline");
    attempt();
    await waitFor(() => expect(hook.result.current.error).toBe(WRITE_FALLBACK.publish));
  });
});

describe("writeGroup", () => {
  it("shows one banner, and each click clears every write's", () => {
    const form = stubForm({ sources: [uploading] });
    const hook = renderHook(() => {
      const a = useEventWrite(form, {
        floor: "publish",
        post: vi.fn(),
        fallback: WRITE_FALLBACK.publish,
        onSuccess: vi.fn(),
        resetAll: () => group.reset(),
      });
      const b = useEventWrite(form, {
        floor: "request",
        post: vi.fn(),
        fallback: WRITE_FALLBACK.publish,
        onSuccess: vi.fn(),
        resetAll: () => group.reset(),
      });
      const group = writeGroup(a, b);
      return { a, b, group };
    });

    act(() => hook.result.current.a.action.attempt());
    expect(hook.result.current.group.error).toBe(UPLOADS_RUNNING_MESSAGE);
    expect(hook.result.current.group.busy).toBe(false);

    // The second write's click clears the first's banner before it sets its own.
    act(() => hook.result.current.b.action.attempt());
    expect(hook.result.current.a.error).toBeNull();
    expect(hook.result.current.b.error).toBe(UPLOADS_RUNNING_MESSAGE);
  });
});
