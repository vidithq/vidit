import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SEARCH_DEBOUNCE_MS } from "@/hooks/useItemSearch";
import { accountKey, analystAccount, type Account } from "@/lib/accounts";
import { accountItem } from "@/lib/items";
import { ItemSearch } from "./ItemSearch";

const ANA: Account = { kind: "analyst", username: "ana" };
const BO: Account = { kind: "analyst", username: "bo" };
const OSW: Account = { kind: "organization", slug: "osw", name: "Open Source Watch" };

const field = () => screen.getByRole("combobox");
// The decorative avatar's initial leads each row's text.
const optionNames = () =>
  screen.queryAllByRole("option").map((o) => o.textContent?.replace(/^[A-Z]/, ""));
const settle = () => act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS));

const accounts = { toItem: accountItem, rowKey: accountKey, "aria-label": "Account" };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("<ItemSearch>", () => {
  it("lists a loaded list on focus, filters it by title and picks with the keyboard", () => {
    const onPick = vi.fn();
    render(<ItemSearch {...accounts} options={[ANA, BO, OSW]} onPick={onPick} emptyText="Nobody." />);

    fireEvent.focus(field());
    expect(optionNames()).toEqual(["anaAnalyst", "boAnalyst", "Open Source WatchOrganization · osw"]);

    fireEvent.change(field(), { target: { value: "b" } });
    expect(optionNames()).toEqual(["boAnalyst"]);
    fireEvent.keyDown(field(), { key: "Enter" });

    expect(onPick).toHaveBeenCalledWith(BO);
    expect(field()).toHaveValue("");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("searches once typing rests, past the minimum length, and shows the note", async () => {
    const search = vi.fn().mockResolvedValue({ rows: [ANA], note: "bob already approved" });
    render(<ItemSearch {...accounts} search={search} minChars={2} onPick={vi.fn()} emptyText="Nobody." />);

    fireEvent.change(field(), { target: { value: "a" } });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.change(field(), { target: { value: "an" } });
    expect(screen.getByRole("status")).toHaveTextContent("Searching…");
    await settle();

    expect(search).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledWith("an", expect.any(AbortSignal));
    expect(optionNames()).toEqual(["anaAnalyst"]);
    expect(screen.getByRole("status")).toHaveTextContent("bob already approved");
  });

  it("drops the answer to a query the text has left", async () => {
    let answer!: (rows: Account[]) => void;
    const search = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Account[]>((resolve) => (answer = resolve)))
      .mockResolvedValue([BO]);
    render(<ItemSearch {...accounts} search={search} onPick={vi.fn()} emptyText="Nobody." />);

    fireEvent.change(field(), { target: { value: "a" } });
    await settle();
    fireEvent.change(field(), { target: { value: "b" } });
    await act(async () => answer([ANA]));
    expect(optionNames()).toEqual([]);
    await settle();

    expect(search.mock.calls[0][1].aborted).toBe(true);
    expect(optionNames()).toEqual(["boAnalyst"]);
  });

  it("shows the empty text, and a failed search", async () => {
    const search = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("down"));
    render(<ItemSearch {...accounts} search={search} onPick={vi.fn()} emptyText="Nobody matches." />);

    fireEvent.change(field(), { target: { value: "zed" } });
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("Nobody matches.");

    fireEvent.change(field(), { target: { value: "zeb" } });
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("The search failed.");
  });

  it("lists the browse rows in an empty field, at once", async () => {
    const search = vi.fn();
    const browse = vi.fn().mockResolvedValue([ANA, OSW]);
    render(<ItemSearch {...accounts} search={search} browse={browse} onPick={vi.fn()} emptyText="Nobody." />);

    fireEvent.focus(field());
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(optionNames()).toHaveLength(2);
    expect(search).not.toHaveBeenCalled();
  });

  it("keeps the text and the list after a pick, and says when every row is hidden", async () => {
    const onPick = vi.fn();
    const { rerender } = render(
      <ItemSearch {...accounts} options={[ANA]} onPick={onPick} keepOpen emptyText="Nobody." hiddenText="All held." />,
    );
    fireEvent.change(field(), { target: { value: "an" } });
    fireEvent.click(screen.getByRole("option", { name: /^ana/ }));
    expect(onPick).toHaveBeenCalledWith(ANA);

    rerender(
      <ItemSearch
        {...accounts}
        options={[ANA]}
        hide={(a) => a === ANA}
        onPick={onPick}
        keepOpen
        emptyText="Nobody."
        hiddenText="All held."
      />,
    );
    expect(field()).toHaveValue("an");
    expect(screen.getByRole("status")).toHaveTextContent("All held.");
  });

  it("picks the row a pasted text names, and hands other text to onSubmitText", () => {
    const onPick = vi.fn();
    const onSubmitText = vi.fn();
    render(
      <ItemSearch
        {...accounts}
        options={[]}
        pasteId={(text) => (text.startsWith("@") ? analystAccount({ username: text.slice(1) }) : null)}
        onPick={onPick}
        onSubmitText={onSubmitText}
        emptyText="Nobody."
      />,
    );
    fireEvent.change(field(), { target: { value: "@cy" } });
    expect(onPick).toHaveBeenCalledWith(analystAccount({ username: "cy" }));
    expect(field()).toHaveValue("");

    fireEvent.change(field(), { target: { value: "zed" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSubmitText).toHaveBeenCalledWith("zed");
  });

  it("shows the pick as an item that its remove button clears", () => {
    const onClear = vi.fn();
    render(<ItemSearch {...accounts} options={[ANA]} selected={OSW} onPick={vi.fn()} onClear={onClear} emptyText="" />);

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("Open Source Watch")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Open Source Watch" }));
    expect(onClear).toHaveBeenCalled();
  });
});
