"use client";

import { useState } from "react";

import { Card } from "@/components/ui/Card";
import { DetailCard, DetailPills, DetailRow } from "@/components/ui/DetailRow";
import { HorizontalScroller } from "@/components/ui/HorizontalScroller";
import { PageCenter } from "@/components/ui/PageFrame";
import { PageWithRail } from "@/components/ui/PageWithRail";
import { ProofSection } from "@/components/ui/ProofSection";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { LIST_TILE } from "@/components/ui/form-styles";
import { CoordinateValue } from "@/components/event/CoordinateActions";
import { StatusBadge } from "@/components/event/StatusBadge";
import { SourceBlock } from "@/components/sources/SourceBlock";
import { MOCK_CONTEXT_SOURCE, MOCK_SOURCE, Variant, type PaletteCategory } from "./shared";

function EyebrowToggle() {
  const [open, setOpen] = useState(false);
  return (
    <SectionEyebrow
      as="h3"
      margin="none"
      title="Source"
      toggle={{ open, onToggle: () => setOpen((o) => !o) }}
    />
  );
}

export const CONTAINERS: PaletteCategory = {
  id: "containers",
  title: "Containers",
  entries: [
    {
      name: "PageFrame",
      demo: (
        <Variant label="PageCenter" className="w-full max-w-md">
          <div className="rounded-md border border-neutral-800">
            <PageCenter className="min-h-32 sm:pl-0">
              <span className="text-neutral-500">Loading…</span>
            </PageCenter>
          </div>
        </Variant>
      ),
    },
    {
      name: "PageWithRail",
      demo: (
        <div className="w-full">
          <PageWithRail
            railLabel="Example rail"
            rail={
              <Card>
                <p className="text-xs text-neutral-300">Rail</p>
              </Card>
            }
          >
            <Card>
              <p className="text-xs text-neutral-300">Main column</p>
            </Card>
          </PageWithRail>
        </div>
      ),
    },
    {
      name: "Card",
      demo: (
        <Card className="w-48">
          <p className="text-xs text-neutral-300">Content</p>
          <p className="text-xs text-neutral-500">Second line</p>
        </Card>
      ),
    },
    {
      name: "DetailCard / DetailRow / DetailPills",
      demo: (
        <>
          <div className="w-full max-w-sm">
            <DetailCard>
              <DetailRow label="Status" concept="status">
                <StatusBadge status="geolocated" />
              </DetailRow>
              <DetailRow label="Event date" concept="occurred_date" value="9 May 2026" />
              <DetailRow label="Coordinates" concept="coordinates" value="48.0159, 37.8024" />
            </DetailCard>
          </div>
          <Variant label="lead" className="w-full max-w-sm">
            <DetailCard lead={<p className="text-sm text-neutral-500">Lead slot</p>}>
              <DetailRow label="Title" value="Drone footage of the strike" />
              <DetailRow label="Capture position" align="center" wrapLabel>
                <CoordinateValue lat={48.0201} lng={37.7951} compact />
              </DetailRow>
              <DetailRow label="Tags" align="start">
                <DetailPills
                  items={[
                    { id: "t1", name: "armor" },
                    { id: "t2", name: "night" },
                  ]}
                />
              </DetailRow>
            </DetailCard>
          </Variant>
          <Variant label="leadBeside" className="w-full max-w-3xl">
            <DetailCard
              leadBeside
              lead={<div className="aspect-video rounded-lg border border-neutral-700 bg-neutral-800" />}
            >
              <DetailRow label="Title" value="Drone footage of the strike" />
              <DetailRow label="Captured" value="1 Jun 2026, 09:30 UTC" />
            </DetailCard>
          </Variant>
        </>
      ),
    },
    {
      name: "LIST_TILE",
      demo: (
        <div className={`${LIST_TILE} max-w-sm space-y-2 text-sm text-neutral-300`}>
          <p>@osint_hawk_2025</p>
          <p className="text-xs text-neutral-500">Requested 2 days ago</p>
        </div>
      ),
    },
    {
      name: "SectionEyebrow",
      demo: (
        <>
          <Variant label="concept">
            <SectionEyebrow title="Details" concept="section_details" />
          </Variant>
          <Variant label="invalid">
            <SectionEyebrow title="Sources" concept="sources" invalid />
          </Variant>
          <Variant label="besideScroller">
            <SectionEyebrow title="Location" concept="section_location" besideScroller />
          </Variant>
          <Variant label="toggle">
            <EyebrowToggle />
          </Variant>
        </>
      ),
    },
    {
      name: "SectionHeading",
      demo: <SectionHeading title="Linked accounts" />,
    },
    {
      name: "HorizontalScroller",
      demo: (
        <div className="w-full max-w-2xl">
          <HorizontalScroller
            heading={<SectionEyebrow margin="none" title="Sources (3)" />}
            label="Sources"
            previousLabel="Previous source"
            nextLabel="Next source"
          >
            {[MOCK_SOURCE, MOCK_CONTEXT_SOURCE, MOCK_SOURCE].map((source, index) => (
              <SourceBlock key={index} source={source} index={index} alt="Strike on a depot" />
            ))}
          </HorizontalScroller>
        </div>
      ),
    },
    {
      name: "ProofSection",
      demo: (
        <>
          <div className="w-full max-w-md">
            <ProofSection>
              <div className="text-sm leading-relaxed text-neutral-300">The proof body.</div>
            </ProofSection>
          </div>
          <Variant label="editor invalid" className="w-full max-w-md">
            <ProofSection editor invalid>
              <div className="text-sm text-neutral-500">The proof editor.</div>
            </ProofSection>
          </Variant>
        </>
      ),
    },
  ],
};
