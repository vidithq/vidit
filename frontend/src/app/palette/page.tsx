"use client";

import { useState } from "react";
import { notFound } from "next/navigation";
import { Search as SearchIcon } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { PageShell } from "@/components/ui/PageShell";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { TEXT_LINK } from "@/components/ui/styles";
import { ACTIONS } from "./actions";
import { BLOCKS, LOW_TOKENS } from "./blocks";
import { CONTAINERS } from "./containers";
import { EVENT } from "./event";
import { FEEDBACK } from "./feedback";
import { FIGURES } from "./figures";
import { FILTERS } from "./filters";
import { INPUTS } from "./inputs";
import { ITEMS } from "./items";
import { MEDIA } from "./media";
import { PEOPLE } from "./people";
import { Entry, entryId, type PaletteCategory, type PaletteTier } from "./shared";
import { TOKENS } from "./tokens";

const TIERS: { id: PaletteTier; title: string; categories: PaletteCategory[] }[] = [
  {
    id: "high",
    title: "High level",
    categories: [CONTAINERS, ACTIONS, INPUTS, FILTERS, FEEDBACK, ITEMS, PEOPLE, FIGURES, MEDIA, EVENT, TOKENS],
  },
  { id: "low", title: "Low level", categories: [BLOCKS, LOW_TOKENS] },
];

type Shown = (typeof TIERS)[number];

function Contents({
  tiers,
  query,
  onQuery,
}: {
  tiers: Shown[];
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
        <ul className="space-y-2 lg:space-y-4">
          {tiers.map((tier) => (
            <li key={tier.id}>
              <a href={`#${tier.id}`} className={`text-sm font-medium ${TEXT_LINK}`}>
                {tier.title}
              </a>
              <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 lg:block lg:space-y-3">
                {tier.categories.map((category) => (
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
  const shown = TIERS.map((tier) => ({
    ...tier,
    categories: tier.categories
      .map((category) => ({
        ...category,
        entries: category.entries.filter((entry) => entry.entry.toLowerCase().includes(needle)),
      }))
      .filter((category) => category.entries.length > 0),
  })).filter((tier) => tier.categories.length > 0);

  return (
    <PageShell
      title="Palette"
      railLabel="Contents"
      rail={<Contents tiers={shown} query={query} onQuery={setQuery} />}
    >
      {shown.map((tier) => (
        <section key={tier.id} id={tier.id} className="scroll-mt-6 space-y-6">
          <SectionHeading title={tier.title} />
          {tier.categories.map((category) => (
            <section key={category.id} id={category.id} className="scroll-mt-6 space-y-3">
              <SectionEyebrow title={category.title} margin="none" />
              {category.entries.map((entry) => (
                <Entry key={entry.entry} name={entry.entry}>
                  {entry.demo}
                </Entry>
              ))}
            </section>
          ))}
        </section>
      ))}
      {shown.length === 0 && <EmptyState>No entry matches.</EmptyState>}
    </PageShell>
  );
}
