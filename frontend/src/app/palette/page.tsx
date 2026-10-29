"use client";

import { useState } from "react";
import { notFound } from "next/navigation";
import { Search as SearchIcon } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { PageShell } from "@/components/ui/PageShell";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { TEXT_LINK } from "@/components/ui/styles";
import { ACTIONS } from "./actions";
import { CONTAINERS } from "./containers";
import { EVENT } from "./event";
import { FEEDBACK } from "./feedback";
import { FIGURES } from "./figures";
import { FILTERS } from "./filters";
import { INPUTS } from "./inputs";
import { ITEMS } from "./items";
import { MEDIA } from "./media";
import { PEOPLE } from "./people";
import { Entry, entryId, type PaletteCategory } from "./shared";
import { TOKENS } from "./tokens";

const CATEGORIES: PaletteCategory[] = [
  CONTAINERS,
  ACTIONS,
  INPUTS,
  FILTERS,
  FEEDBACK,
  ITEMS,
  PEOPLE,
  FIGURES,
  MEDIA,
  EVENT,
  TOKENS,
];

function Contents({
  categories,
  query,
  onQuery,
}: {
  categories: PaletteCategory[];
  query: string;
  onQuery: (query: string) => void;
}) {
  return (
    <Card dense>
      <Input
        type="search"
        icon={<SearchIcon size={14} />}
        aria-label="Filter entries by name"
        placeholder="Filter by name"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      <nav aria-label="Contents">
        <ul className="flex flex-wrap gap-x-3 gap-y-1 lg:block lg:space-y-3">
          {categories.map((category) => (
            <li key={category.id}>
              <a href={`#${category.id}`} className={`text-xs font-medium ${TEXT_LINK}`}>
                {category.title}
              </a>
              <ul className="mt-1 hidden space-y-0.5 pl-3 lg:block">
                {category.entries.map((entry) => (
                  <li key={entry.entry}>
                    <a href={`#${entryId(entry.entry)}`} className={`font-mono text-[11px] ${TEXT_LINK}`}>
                      {entry.entry}
                    </a>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </nav>
    </Card>
  );
}

export default function PalettePage() {
  // Dev reference only: a 404 in production / preview builds.
  if (process.env.NODE_ENV !== "development") notFound();

  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = CATEGORIES.map((category) => ({
    ...category,
    entries: category.entries.filter((entry) => entry.entry.toLowerCase().includes(needle)),
  })).filter((category) => category.entries.length > 0);

  return (
    <PageShell
      title="Palette"
      railLabel="Contents"
      rail={<Contents categories={shown} query={query} onQuery={setQuery} />}
    >
      {shown.map((category) => (
        <section key={category.id} id={category.id} className="scroll-mt-6 space-y-3">
          <SectionEyebrow title={category.title} margin="none" />
          {category.entries.map((entry) => (
            <Entry key={entry.entry} name={entry.entry}>
              {entry.demo}
            </Entry>
          ))}
        </section>
      ))}
      {shown.length === 0 && <EmptyState>No entry matches.</EmptyState>}
    </PageShell>
  );
}
