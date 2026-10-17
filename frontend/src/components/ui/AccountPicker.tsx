"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/cn";
import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";
import { Avatar } from "./Avatar";
import { Input } from "./Input";
import { Pill } from "./Pill";
import { TOOLTIP_SURFACE } from "./styles";

export type Account =
  | { kind: "analyst"; username: string; avatar_url?: string | null }
  | { kind: "organization"; slug: string; name: string; avatar_url?: string | null };

export function analystAccount(ref: { username: string; avatar_url?: string | null }): Account {
  return { kind: "analyst", username: ref.username, avatar_url: ref.avatar_url };
}

export function accountName(account: Account): string {
  return account.kind === "analyst" ? account.username : account.name;
}

function accountKey(account: Account): string {
  return account.kind === "analyst" ? `analyst:${account.username}` : `organization:${account.slug}`;
}

function matches(account: Account, query: string): boolean {
  const needle = query.toLowerCase();
  const fields = account.kind === "analyst" ? [account.username] : [account.name, account.slug];
  return fields.some((field) => field.toLowerCase().includes(needle));
}

// Not a fetch per keystroke, but up by the time typing stops.
const SEARCH_DEBOUNCE_MS = 250;

const ROW =
  "flex w-full min-h-9 cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-sm text-neutral-200";
const STATUS_ROW = "px-2.5 py-1.5 text-xs text-neutral-500";

// Hidden from assistive tech: the row names the account, and the initial fallback would prefix it.
function AccountAvatar({ account, size }: { account: Account; size: string }) {
  return (
    <span aria-hidden className="contents">
      <Avatar
        src={account.avatar_url}
        username={accountName(account)}
        size={size}
        as="span"
        decorative
        shape={account.kind === "organization" ? "square" : "circle"}
      />
    </span>
  );
}

/** What a search resolves to: the rows, or the rows with a `note` (why a match is left out). */
type SearchResult = Account[] | { accounts: Account[]; note: string | null };

type Source =
  | { options: Account[]; search?: never }
  | { search: (query: string) => Promise<SearchResult>; options?: never };

type AccountPickerProps = Source & {
  id?: string;
  "aria-label"?: string;
  placeholder?: string;
  emptyText: string;
  minQueryLength?: number;
  onSelect: (account: Account) => void;
  onSubmitText?: (text: string) => void;
  onQueryChange?: () => void;
  selected?: Account | null;
  onClear?: () => void;
  autoFocus?: boolean;
  className?: string;
};

/**
 * A combobox that picks one analyst or organization. `options` filters a local list by name and
 * handle; `search` runs the caller's request, debounced, once the query holds `minQueryLength`
 * characters, and a `note` it returns shows as a muted row. Enter takes the highlighted row, or
 * hands the typed text to `onSubmitText` when no row is up. With `selected`, the pick shows as a chip that `onClear` removes; without it, the
 * field empties after each pick.
 */
export function AccountPicker({
  options,
  search,
  id,
  "aria-label": ariaLabel,
  placeholder,
  emptyText,
  minQueryLength = 0,
  onSelect,
  onSubmitText,
  onQueryChange,
  selected,
  onClear,
  autoFocus,
  className,
}: AccountPickerProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(!!autoFocus);
  const [active, setActive] = useState(0);
  // `accounts` is null when the request failed. Keyed by its query, so rows never belong to an
  // older one.
  const [result, setResult] = useState<{
    query: string;
    accounts: Account[] | null;
    note?: string | null;
  } | null>(null);

  const q = query.trim();
  const ready = q.length >= minQueryLength;

  useDebouncedEffect(
    () => {
      if (!search || !open || !ready) return;
      let cancelled = false;
      search(q).then(
        (found) => {
          if (cancelled) return;
          setResult(
            Array.isArray(found) ? { query: q, accounts: found } : { query: q, ...found },
          );
        },
        () => {
          if (!cancelled) setResult({ query: q, accounts: null });
        },
      );
      return () => {
        cancelled = true;
      };
    },
    [q, open, ready],
    SEARCH_DEBOUNCE_MS,
  );

  const current = result?.query === q ? result : null;
  const loading = !!search && !current;
  const failed = !!current && current.accounts === null;
  const rows = options
    ? options.filter((account) => matches(account, q))
    : (current?.accounts ?? []);
  const activeIndex = Math.min(active, rows.length - 1);
  const shown = open && ready;
  const optionId = (index: number) => `${listId}-${index}`;

  const close = () => {
    setQuery("");
    setOpen(false);
  };

  const choose = (account: Account) => {
    onSelect(account);
    close();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        if (!shown) return setOpen(true);
        if (rows.length === 0) return;
        const step = e.key === "ArrowDown" ? 1 : -1;
        return setActive((activeIndex + step + rows.length) % rows.length);
      }
      case "Enter":
        e.preventDefault();
        if (shown && !loading && rows[activeIndex]) return choose(rows[activeIndex]);
        if (onSubmitText && q) {
          onSubmitText(q);
          close();
        }
        return;
      case "Escape":
        if (open) {
          e.preventDefault();
          setOpen(false);
        }
    }
  };

  if (selected) {
    const name = accountName(selected);
    return (
      <div>
        <Pill
          tone="accent"
          title={`Remove ${name}`}
          icon={<AccountAvatar account={selected} size="size-4" />}
          onClick={() => {
            onClear?.();
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        >
          {name}
          <X size={12} aria-hidden />
        </Pill>
      </div>
    );
  }

  return (
    <div className="relative w-full">
      <Input
        ref={inputRef}
        id={id}
        aria-label={ariaLabel}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={
          shown && !loading && rows[activeIndex] ? optionId(activeIndex) : undefined
        }
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
          onQueryChange?.();
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        autoFocus={autoFocus}
        className={className}
      />
      {shown && (
        <div
          // Keeps focus in the field, so a click on a row lands before the blur closes the list.
          onMouseDown={(e) => e.preventDefault()}
          className={cn(
            "absolute inset-x-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-md p-1",
            TOOLTIP_SURFACE,
          )}
        >
          <ul id={listId} role="listbox" aria-label={ariaLabel} className="space-y-0.5">
            {!loading &&
              rows.map((account, index) => (
                <li
                  key={accountKey(account)}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === activeIndex}
                  onClick={() => choose(account)}
                  onMouseEnter={() => setActive(index)}
                  className={cn(ROW, index === activeIndex && "bg-neutral-700")}
                >
                  <AccountAvatar account={account} size="size-6" />
                  <span className="min-w-0 truncate">{accountName(account)}</span>
                  {account.kind === "organization" && " "}
                  {account.kind === "organization" && (
                    <span className="min-w-0 truncate text-xs text-neutral-500">
                      {account.slug}
                    </span>
                  )}
                </li>
              ))}
          </ul>
          {(loading || failed || rows.length === 0 || current?.note) && (
            <p role="status" className={STATUS_ROW}>
              {loading
                ? "Searching…"
                : failed
                  ? "Could not load suggestions"
                  : (current?.note ?? emptyText)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
