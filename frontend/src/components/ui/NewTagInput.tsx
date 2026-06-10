"use client";

import { useState, type KeyboardEvent } from "react";

import { FORM_INPUT } from "@/components/ui/form-styles";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import { ApiError, apiFetch } from "@/lib/api";
import type { Tag } from "@/types";

// Inline "create a free tag" affordance for the submit forms. `free` is the
// only category an analyst can create — `conflict` is admin-curated (see
// `backend/app/routers/tags.py::USER_CREATABLE_CATEGORIES`).
//
// 409 = name already exists in the DB (case-sensitive). Surfaced as a
// non-blocking message; the existing tag may be hidden from /tags because it
// has zero live geolocations (the orphan filter), but that's not worth a
// special path until it bites.

interface Props {
  existingTags: Tag[];
  onCreated: (tag: Tag) => void;
  disabled?: boolean;
}

export function NewTagInput({ existingTags, onCreated, disabled }: Props) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const canSubmit = !disabled && !busy && trimmed.length > 0;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);

    // Already in the local list: skip the round-trip and auto-select. Matched
    // exact + case-sensitive (the backend uniqueness rule) so a near-match
    // casing isn't masked as an existing tag.
    const local = existingTags.find(
      (t) => t.name === trimmed && t.category === "free",
    );
    if (local) {
      onCreated(local);
      setName("");
      setBusy(false);
      return;
    }

    try {
      const created = await apiFetch<Tag>("/tags", {
        method: "POST",
        body: JSON.stringify({ name: trimmed, category: "free" }),
      });
      onCreated(created);
      setName("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError("That tag already exists.");
      } else if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError("Could not create tag.");
      }
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={onKeyDown}
          disabled={disabled || busy}
          maxLength={100}
          placeholder="New free tag (e.g. drone)"
          aria-label="New free tag name"
          className={`${FORM_INPUT} flex-1 max-w-xs`}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className={`px-3 py-2 rounded-md text-xs disabled:opacity-50 ${PRIMARY_BUTTON}`}
        >
          + Add
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
