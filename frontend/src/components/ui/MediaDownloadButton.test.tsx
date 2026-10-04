import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MediaDownloadButton } from "./MediaDownloadButton";
import type { Media } from "@/types";

const MEDIA: Media = {
  id: "m1",
  role: "source",
  storage_url: "https://cdn.example.com/uploads/g1/abc.jpg",
  media_type: "image",
  sha256: null,
  original_filename: "dashcam-original.jpg",
};

// jsdom implements neither half of the object-URL API: install both, restore
// afterwards.
const realObjectUrlApi = {
  createObjectURL: URL.createObjectURL,
  revokeObjectURL: URL.revokeObjectURL,
};

// The save is an anchor the component builds, clicks and removes. The click
// carries the resolved filename and happens while the anchor is in the document
// (Firefox ignores a click on a detached one).
//
// The fetch stand-in is a plain object: the component reads `ok` and passes the
// body to the mocked `createObjectURL`.
function captureSave({ ok = true }: { ok?: boolean } = {}) {
  const saves: { filename: string; connected: boolean }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saves.push({ filename: this.download, connected: this.isConnected });
  });
  const revokeObjectURL = vi.fn();
  Object.assign(URL, { createObjectURL: () => "blob:saved-1", revokeObjectURL });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, status: ok ? 200 : 403, blob: async () => ({}) })),
  );
  return { saves, revokeObjectURL };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.assign(URL, realObjectUrlApi);
});

describe("MediaDownloadButton", () => {
  it("saves a persisted row under its original filename, from a connected anchor", async () => {
    const { saves, revokeObjectURL } = captureSave();
    render(<MediaDownloadButton source={MEDIA} />);

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].filename).toBe("dashcam-original.jpg");
    expect(saves[0].connected).toBe(true);
    expect(document.querySelector("a[download]")).toBeNull();
    // Released on a later task, so revoking cannot cancel the download.
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:saved-1"));
  });

  it("falls through an empty name to the URL's basename", async () => {
    const { saves } = captureSave();
    render(<MediaDownloadButton source={{ ...MEDIA, original_filename: "" }} />);

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].filename).toBe("abc.jpg");
  });

  it("falls through to a generic name when the path has no basename either", async () => {
    const { saves } = captureSave();
    render(<MediaDownloadButton source={{ src: "https://cdn.example.com/" }} />);

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].filename).toBe("media");
  });

  it("reports a failed fetch on the control itself", async () => {
    captureSave({ ok: false });
    render(<MediaDownloadButton source={MEDIA} />);

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    // Keeps the outcome and stays clickable for a retry.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Download failed, retry" })).toBeEnabled(),
    );
  });
});
