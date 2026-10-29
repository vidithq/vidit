"use client";

import { useState } from "react";
import { Archive, MapPin } from "lucide-react";

import { Button, buttonClasses } from "@/components/ui/Button";
import { CountBadge } from "@/components/ui/CountBadge";
import { Dot } from "@/components/ui/Dot";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorNotice, FieldError } from "@/components/ui/ErrorNotice";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { Input } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Pill";
import { Tooltip } from "@/components/ui/Tooltip";
import { WithheldBanner } from "@/components/ui/WithheldBanner";
import { FORM_ERROR_BANNER, FORM_SUCCESS_BANNER } from "@/components/ui/form-styles";
import { TEXT_LINK } from "@/components/ui/styles";
import { StatusBadge } from "@/components/event/StatusBadge";
import { NO_ANSWER } from "@/lib/errors";
import { Variant, type PaletteCategory } from "./shared";

function PaletteChips() {
  const [selected, setSelected] = useState("Open");
  return (
    <Variant label="onClick">
      <div className="flex flex-wrap gap-2">
        {["All", "Open", "Closed"].map((label) => (
          <Pill
            key={label}
            tone={selected === label ? "accent" : "neutral"}
            onClick={() => setSelected(label)}
          >
            {label}
          </Pill>
        ))}
      </div>
    </Variant>
  );
}

export const FEEDBACK: PaletteCategory = {
  id: "feedback",
  title: "Feedback",
  entries: [
    {
      name: "ErrorNotice",
      demo: (
        <>
          <Variant label="onRetry" className="w-full max-w-sm">
            <ErrorNotice error={NO_ANSWER} onRetry={() => {}} />
          </Variant>
          <Variant label="refusal" className="w-full max-w-sm">
            <ErrorNotice error="This invite code was already used." />
          </Variant>
        </>
      ),
    },
    {
      name: "FieldError",
      demo: (
        <div className="w-full max-w-sm space-y-1.5">
          <FieldLabel label="Invitee's X handle" htmlFor="palette-field-error" invalid />
          <Input
            id="palette-field-error"
            invalid
            defaultValue="@this_handle_is_too_long"
            aria-describedby="palette-field-error-text"
          />
          <FieldError id="palette-field-error-text">
            15 characters at most: letters, digits and _.
          </FieldError>
        </div>
      ),
    },
    {
      name: "FORM_ERROR_BANNER",
      demo: <div className={`${FORM_ERROR_BANNER} max-w-sm`}>Your session ended.</div>,
    },
    {
      name: "FORM_SUCCESS_BANNER",
      demo: <div className={`${FORM_SUCCESS_BANNER} max-w-sm`}>Saved.</div>,
    },
    {
      name: "WithheldBanner",
      demo: <WithheldBanner since="2026-10-28T09:30:00Z" noun="collection" />,
    },
    {
      name: "EmptyState",
      demo: (
        <>
          <Variant label="boxed" className="w-full max-w-sm">
            <EmptyState>
              Nothing here yet.{" "}
              <a href="#" className={TEXT_LINK} onClick={(e) => e.preventDefault()}>
                Create the first one
              </a>
              .
            </EmptyState>
          </Variant>
          <Variant label="plain" className="w-full max-w-sm">
            <EmptyState
              variant="plain"
              lead="Nothing to review."
              cta={
                <a href="#" className={`text-xs ${TEXT_LINK}`} onClick={(e) => e.preventDefault()}>
                  Back to profile
                </a>
              }
            >
              New items land here once something happens.
            </EmptyState>
          </Variant>
          <Variant label="invite" className="w-full max-w-sm">
            <EmptyState
              variant="invite"
              icon={MapPin}
              lead="Your feed is empty"
              cta={
                <Button action="map" variant="primary">
                  Explore the map
                </Button>
              }
            >
              Follow other analysts to see their latest geolocations here.
            </EmptyState>
          </Variant>
        </>
      ),
    },
    {
      name: "Pill",
      demo: (
        <>
          <Variant label="tone">
            <div className="flex flex-wrap gap-2">
              <Pill tone="accent" icon={<MapPin size={11} />}>
                accent
              </Pill>
              <Pill tone="secondary">secondary</Pill>
              <Pill tone="neutral">neutral</Pill>
              <Pill tone="danger">danger</Pill>
              <Pill tone="warning">warning</Pill>
            </div>
          </Variant>
          <Variant label="label">
            <div className="flex flex-wrap gap-2">
              <Pill label="Conflict">Russo-Ukrainian war</Pill>
              <Pill label="Kind">Smartphone</Pill>
              <Pill>airstrike</Pill>
            </div>
          </Variant>
          <PaletteChips />
        </>
      ),
    },
    {
      name: "StatusBadge",
      demo: (
        <>
          <StatusBadge status="requested" />
          <StatusBadge status="detected" />
          <StatusBadge status="geolocated" />
          <StatusBadge status="closed" />
        </>
      ),
    },
    {
      name: "CountBadge",
      demo: (
        <CountBadge count={2} label="2 missing: Title, Conflict">
          {(describedBy) => (
            <Button action="geolocate" variant="primary" aria-describedby={describedBy}>
              Publish
            </Button>
          )}
        </CountBadge>
      ),
    },
    {
      name: "Dot",
      demo: (
        <>
          <Dot />
          <span className="relative inline-flex size-7 items-center justify-center rounded-md border border-neutral-700 bg-neutral-800">
            <MapPin size={14} className="text-neutral-400" />
            <Dot className="absolute -top-0.5 -right-1 ring-2 ring-neutral-900" />
          </span>
        </>
      ),
    },
    {
      name: "Tooltip",
      demo: (
        <Tooltip label="Wayback Machine copy of the source">
          <a
            href="#"
            aria-label="Wayback Machine copy of the source"
            className={buttonClasses("ghost", { icon: true })}
          >
            <Archive size={14} />
          </a>
        </Tooltip>
      ),
    },
  ],
};
