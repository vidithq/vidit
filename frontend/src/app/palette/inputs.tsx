"use client";

import { useState } from "react";
import { Search as SearchIcon } from "lucide-react";

import type { Conflict, Tag } from "@/types";
import { ActionIcon, Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ChoiceRow } from "@/components/ui/ChoiceRow";
import { Combobox } from "@/components/ui/Combobox";
import { DateTimeInput } from "@/components/ui/DateTimeInput";
import { CharCounter } from "@/components/ui/CharCounter";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { IncompleteFormAnnouncer } from "@/components/ui/IncompleteFormAnnouncer";
import { Input, Select } from "@/components/ui/Input";
import { ItemSearch } from "@/components/ui/ItemSearch";
import { LinkListInput } from "@/components/ui/LinkListInput";
import { OptionSearch } from "@/components/ui/OptionSearch";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SwatchPicker } from "@/components/ui/SwatchPicker";
import { Switch } from "@/components/ui/Switch";
import { TagPicker } from "@/components/ui/TagPicker";
import {
  FORM_INVALID_FIELD,
  FORM_INVALID_LABEL,
  FORM_LABEL,
  FORM_LABEL_COMPACT,
  LABEL_TEXT,
} from "@/components/ui/form-styles";
import { ArchiveBox, ArchiveSnapshotField, linkDescription } from "@/components/sources/ArchivedCopies";
import { accountKey, type Account } from "@/lib/accounts";
import { safeHostname } from "@/lib/format";
import { EVENT_FIELDS } from "@/lib/events";
import { accountItem } from "@/lib/items";
import { SOURCE_FIELDS } from "@/lib/sources";
import { MOCK_CONFLICTS, Variant, type PaletteCategory } from "./shared";

const FIELD = "w-64 max-w-full";


const MOCK_ACCOUNTS: Account[] = [
  { kind: "analyst", username: "ana-demo" },
  { kind: "analyst", username: "bo-demo" },
  { kind: "organization", slug: "open-source-watch", name: "Open Source Watch" },
];

function PaletteLinkList({ wide }: { wide?: boolean }) {
  const [links, setLinks] = useState<string[]>(["https://t.me/channel/12345"]);
  const describes = (row: string, index: number) =>
    linkDescription(0, safeHostname(row), index, links.length);
  return (
    <LinkListInput<string>
      rows={links}
      onChange={setLinks}
      urlOf={(url) => url}
      withUrl={(_, url) => url}
      blank={() => ""}
      max={3}
      itemLabel="Link"
      placeholder="https://x.com/user/status/12345"
      heading={
        wide ? (
          <>
            Links <FieldHelp concept="source_links" />
          </>
        ) : undefined
      }
      columns={
        wide
          ? [
              {
                header: "Posted (UTC)",
                width: "13rem",
                cell: ({ index }) => (
                  <DateTimeInput
                    type="datetime-local"
                    variant="compact"
                    aria-label={`Posted (UTC), link ${index + 1}`}
                    value=""
                    onChange={() => {}}
                  />
                ),
              },
              {
                header: "Archive",
                width: "auto",
                cell: ({ index, row, expanded, toggle }) => (
                  <ArchiveBox
                    describes={describes(row, index)}
                    snapshot={index === 0 ? "https://archive.ph/abcde" : ""}
                    expanded={expanded}
                    onToggle={toggle}
                  />
                ),
              },
            ]
          : undefined
      }
      expansion={
        wide
          ? ({ index, row }) => (
              <ArchiveSnapshotField
                link={row}
                describes={describes(row, index)}
                value=""
                onChange={() => {}}
              />
            )
          : undefined
      }
    />
  );
}

function PaletteOptionSearch() {
  const tagOptions = [
    { value: "Ukraine", label: "Ukraine" },
    { value: "Drone", label: "Drone" },
  ];
  const [tags, setTags] = useState<string[]>([tagOptions[0].value]);
  const [kind, setKind] = useState<string[]>([]);
  return (
    <>
      <Variant label="suggestions" className={FIELD}>
        <OptionSearch
          aria-label="Tags"
          placeholder="Search tags"
          options={tagOptions}
          selected={tags}
          onChange={setTags}
          suggestions={tagOptions}
        />
      </Variant>
      <Variant label="single required" className={FIELD}>
        <OptionSearch
          single
          required
          aria-label="Kind"
          placeholder="Search source kinds"
          options={[
            { value: "video", label: "Video" },
            { value: "photo", label: "Photo" },
            { value: "satellite", label: "Satellite" },
          ]}
          selected={kind}
          onChange={setKind}
          invalid={kind.length === 0}
        />
      </Variant>
    </>
  );
}

function PaletteItemSearch() {
  const [picked, setPicked] = useState<Account | null>(null);
  const shared = {
    options: MOCK_ACCOUNTS,
    toItem: accountItem,
    rowKey: accountKey,
    placeholder: "Search analysts and organizations",
    emptyText: "No analyst or organization matches.",
  };
  return (
    <>
      <div className={FIELD}>
        <ItemSearch {...shared} aria-label="Pick an account" onPick={() => undefined} />
      </div>
      <Variant label="selected" className={FIELD}>
        <ItemSearch
          {...shared}
          aria-label="Pick an account to keep"
          selected={picked}
          onPick={setPicked}
          onClear={() => setPicked(null)}
        />
      </Variant>
      <Variant label="in a clipping card">
        <Card className="w-56 overflow-hidden">
          <ItemSearch {...shared} aria-label="Pick an account in a card" onPick={() => undefined} />
        </Card>
      </Variant>
    </>
  );
}

function PaletteTagPicker() {
  const [tags, setTags] = useState<Tag[]>([
    { id: "f1", name: "donetsk" },
    { id: "f2", name: "armor" },
    { id: "f3", name: "drone" },
    { id: "f4", name: "artillery" },
  ]);
  const [selected, setSelected] = useState<string[]>([]);
  const [conflicts, setConflicts] = useState<string[]>([]);
  return (
    <div className="w-full max-w-2xl">
      <TagPicker
        tags={tags}
        setTags={setTags}
        suggestedTags={tags}
        selectedTagIds={selected}
        setSelectedTagIds={setSelected}
        conflicts={MOCK_CONFLICTS}
        selectedConflictIds={conflicts}
        setSelectedConflictIds={setConflicts}
      />
    </div>
  );
}

function PaletteSegmentedControl() {
  const [scope, setScope] = useState<"single" | "bulk">("single");
  const [mode, setMode] = useState<"soft" | "hard">("soft");
  return (
    <>
      <SegmentedControl
        aria-label="Preview mode"
        options={[
          { value: "single", label: "Single" },
          { value: "bulk", label: "Bulk import" },
        ]}
        value={scope}
        onChange={setScope}
      />
      <Variant label="tone danger">
        <SegmentedControl
          aria-label="Preview delete mode"
          options={[
            { value: "soft", label: "Soft delete" },
            { value: "hard", label: "Hard delete", tone: "danger" },
          ]}
          value={mode}
          onChange={setMode}
        />
      </Variant>
    </>
  );
}

function PaletteSwitch() {
  const [on, setOn] = useState(true);
  return (
    <>
      <Variant label="md">
        <Switch on={on} onToggle={() => setOn(!on)} aria-label="Preview switch" />
      </Variant>
      <Variant label="sm">
        <Switch size="sm" on={on} onToggle={() => setOn(!on)} aria-label="Preview switch small" />
      </Variant>
      <Variant label="disabled">
        <Switch on disabled aria-label="Demo switch locked" />
      </Variant>
    </>
  );
}

function PaletteChoiceRow() {
  const [value, setValue] = useState<"following" | "everyone" | "nobody">("following");
  return (
    <div className="w-full max-w-lg rounded-lg border border-neutral-700 bg-neutral-900 p-3">
      <ChoiceRow
        label="Accept requests from"
        description="Who can ask you."
        options={[
          { value: "following", label: "People I follow" },
          { value: "everyone", label: "Everyone" },
          { value: "nobody", label: "Nobody" },
        ]}
        value={value}
        onChange={setValue}
      />
    </div>
  );
}

function PaletteSwatchPicker() {
  const [value, setValue] = useState("orange");
  return (
    <SwatchPicker
      aria-label="Preview accent color"
      options={[
        { value: "orange", label: "Orange", color: "#f97316" },
        { value: "blue", label: "Blue", color: "#3b82f6" },
        { value: "emerald", label: "Emerald", color: "#10b981" },
        { value: "violet", label: "Violet", color: "#8b5cf6" },
        { value: "rose", label: "Rose", color: "#f43f5e" },
      ]}
      value={value}
      onChange={setValue}
    />
  );
}

const CITIES = ["Kharkiv", "Kherson", "Kyiv", "Lviv", "Odesa"];

function PaletteCombobox() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const options = CITIES.filter((city) => city.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="w-64 max-w-full">
      <Combobox
        aria-label="City"
        placeholder="Search cities"
        query={query}
        onQueryChange={setQuery}
        open={open}
        onOpenChange={setOpen}
        options={options}
        optionKey={(city) => city}
        renderOption={(city) => city}
        pillOption={() => true}
        onPick={() => {
          setQuery("");
          setOpen(false);
        }}
        status={options.length === 0 ? "No match." : null}
      />
    </div>
  );
}

export const INPUTS: PaletteCategory = {
  id: "inputs",
  title: "Inputs, labels and search",
  entries: [
    {
      entry: "Input / FORM_INVALID_FIELD", tier: "low",
      demo: (
        <>
          <div className={FIELD}>
            <Input placeholder="Type here..." />
          </div>
          <Variant label="icon" className={FIELD}>
            <Input icon={<SearchIcon size={14} />} type="search" placeholder="Search…" />
          </Variant>
          <Variant label="trailing" className={FIELD}>
            <Input
              placeholder="https://t.me/channel/12345"
              trailing={
                <Button icon variant="ghost" aria-label="Clear the field">
                  <ActionIcon action="remove" />
                </Button>
              }
            />
          </Variant>
          <Variant label="compact" className={FIELD}>
            <Input variant="compact" placeholder="Compact" />
          </Variant>
          <Variant label="locked" className={FIELD}>
            <Input variant="locked" value="Locked" readOnly />
          </Variant>
          <Variant label="invalid" className={FIELD}>
            <Input invalid placeholder="Invalid field" />
          </Variant>
          <Variant label="FORM_INVALID_FIELD" className={FIELD}>
            <div
              className={`rounded-md border border-neutral-700 bg-neutral-900 p-3 text-xs text-neutral-400 ${FORM_INVALID_FIELD}`}
            >
              A section card flagged as missing.
            </div>
          </Variant>
        </>
      ),
    },
    {
      entry: "Select", tier: "high",
      demo: (
        <>
          <div className={FIELD}>
            <Select defaultValue="">
              <option value="">Not now</option>
              <option value="drone">Drone</option>
              <option value="ground">Ground</option>
              <option value="satellite">Satellite</option>
            </Select>
          </div>
          <Variant label="compact" className={FIELD}>
            <Select variant="compact" defaultValue="drone">
              <option value="drone">Drone</option>
              <option value="ground">Ground</option>
            </Select>
          </Variant>
          <Variant label="invalid" className={FIELD}>
            <Select invalid defaultValue="">
              <option value="">Pick a kind</option>
              <option value="drone">Drone</option>
            </Select>
          </Variant>
        </>
      ),
    },
    {
      entry: "DateTimeInput", tier: "high",
      demo: (
        <>
          <Variant label="date" className={FIELD}>
            <DateTimeInput type="date" value="" onChange={() => {}} />
          </Variant>
          <Variant label="time" className={FIELD}>
            <DateTimeInput type="time" value="14:30" onChange={() => {}} />
          </Variant>
          <Variant label="datetime-local" className={FIELD}>
            <DateTimeInput type="datetime-local" value="2026-06-01T14:30" onChange={() => {}} />
          </Variant>
          <Variant label="invalid" className={FIELD}>
            <DateTimeInput type="date" value="" invalid onChange={() => {}} />
          </Variant>
        </>
      ),
    },
    {
      entry: "LinkListInput", tier: "high",
      demo: (
        <>
          <Variant label="columns" className="w-full">
            <PaletteLinkList wide />
          </Variant>
          <Variant label="narrow" className="w-full max-w-sm">
            <PaletteLinkList />
          </Variant>
        </>
      ),
    },
    { entry: "OptionSearch", tier: "high", demo: <PaletteOptionSearch /> },
    { entry: "ItemSearch", tier: "high", demo: <PaletteItemSearch /> },
    { entry: "TagPicker", tier: "high", demo: <PaletteTagPicker /> },
    { entry: "SegmentedControl", tier: "high", demo: <PaletteSegmentedControl /> },
    { entry: "Switch", tier: "high", demo: <PaletteSwitch /> },
    { entry: "ChoiceRow", tier: "high", demo: <PaletteChoiceRow /> },
    { entry: "SwatchPicker", tier: "high", demo: <PaletteSwatchPicker /> },
    {
      entry: "FORM_LABEL / FORM_LABEL_COMPACT", tier: "high",
      demo: (
        <div className="space-y-2">
          <label className={FORM_LABEL}>FORM_LABEL</label>
          <label className={FORM_LABEL_COMPACT}>FORM_LABEL_COMPACT</label>
        </div>
      ),
    },
    {
      entry: "LABEL_TEXT / FORM_INVALID_LABEL", tier: "low",
      demo: (
        <div className="space-y-2">
          <span className={LABEL_TEXT}>LABEL_TEXT</span>
          <label className={`${FORM_LABEL} ${FORM_INVALID_LABEL}`}>FORM_INVALID_LABEL</label>
        </div>
      ),
    },
    {
      entry: "FieldLabel", tier: "high",
      demo: (
        <div className="w-full max-w-sm space-y-3">
          <FieldLabel {...EVENT_FIELDS.occurred_date} htmlFor="palette-field-label" />
          <FieldLabel {...EVENT_FIELDS.coordinates} invalid />
          <FieldLabel {...SOURCE_FIELDS.title} trailing={<CharCounter length={12} max={200} />} />
        </div>
      ),
    },
    {
      entry: "CharCounter", tier: "high",
      demo: (
        <>
          <CharCounter length={120} max={500} />
          <CharCounter length={512} max={500} />
        </>
      ),
    },
    {
      entry: "FieldHelp", tier: "low",
      demo: (
        <span className="inline-flex items-center gap-3 text-sm text-neutral-300">
          <span className="inline-flex items-center gap-1">
            Coordinates <FieldHelp concept="coordinates" />
          </span>
          <span className="inline-flex items-center gap-1">
            Relief <FieldHelp concept="map_relief" />
          </span>
        </span>
      ),
    },
    {
      entry: "IncompleteFormAnnouncer", tier: "high",
      demo: (
        <IncompleteFormAnnouncer missing={["Coordinates", "Conflict", "Proof"]} attempt={1} />
      ),
    },
    { entry: "Combobox", tier: "low", demo: <PaletteCombobox /> },
  ],
};
