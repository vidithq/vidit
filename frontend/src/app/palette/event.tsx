"use client";

import { useState } from "react";

import type { Tag } from "@/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { RemoveButton } from "@/components/ui/RemoveButton";
import {
  PUBLISHING_LABEL,
  PUBLISH_CONFIRM,
  PublishActions,
  REQUEST_CONFIRM,
  SAVING_LABEL,
  publishGeolocationButton,
  requestWriteButton,
  usePublishAction,
} from "@/components/geolocations/PublishActions";
import { SourcesField } from "@/components/sources/SourcesField";
import { eventPanelContent } from "@/components/event/EventDetailBody";
import { MapPanelBody } from "@/components/map/MapSidePanel";
import { sourceDraftFrom, type Source, type SourceDraft } from "@/lib/sources";
import { EventShellPreview } from "./eventShellDemo";
import { MOCK_CONTEXT_SOURCE, MOCK_DETAIL, MOCK_SOURCE, Variant, type PaletteCategory } from "./shared";

// Reference imagery on a listed provider, for the provider check.
const MOCK_SATELLITE_SOURCE: Source = {
  ...MOCK_CONTEXT_SOURCE,
  id: "s3",
  kind: "satellite",
  links: [{ url: "https://earth.google.com/web/@48.0201,37.7951,50a", posted_at: null, archived: null }],
};

function PaletteSourcesField() {
  const [sources, setSources] = useState<SourceDraft[]>(() =>
    [MOCK_SOURCE, MOCK_CONTEXT_SOURCE, MOCK_SATELLITE_SOURCE].map(sourceDraftFrom),
  );
  const [tags, setTags] = useState<Tag[]>([
    { id: "f1", name: "armor" },
    { id: "f2", name: "drone" },
  ]);
  return (
    <div className="w-full max-w-2xl">
      <SourcesField
        sources={sources}
        setSources={setSources}
        tags={tags}
        setTags={setTags}
        suggestedTags={tags}
        invalidKeys={new Set()}
      />
    </div>
  );
}

function PalettePublishActions() {
  const [note, setNote] = useState("");
  const publish = usePublishAction({ check: () => true, write: () => undefined, confirm: PUBLISH_CONFIRM });
  const request = usePublishAction({ check: () => true, write: () => undefined, confirm: REQUEST_CONFIRM });
  const save = usePublishAction({ check: () => true, write: () => undefined, ask: true });
  return (
    <>
      <Variant label="confirm" className="w-full max-w-md">
        <PublishActions
          disabled={false}
          help="action_submit"
          buttons={[
            publishGeolocationButton(
              { action: publish, busy: false, missing: [{ key: "proof", label: "Proof" }] },
              "Publish geolocation",
            ),
            requestWriteButton({ action: request, busy: false }, "Publish request", PUBLISHING_LABEL),
          ]}
        />
      </Variant>
      <Variant label="ask" className="w-full max-w-md">
        <PublishActions
          disabled={false}
          buttons={[
            {
              action: save,
              label: "Save version 3",
              busyLabel: SAVING_LABEL,
              busy: false,
              variant: "primary",
              icon: "save",
              ask: {
                label: "Version note",
                content: (
                  <>
                    <Input
                      aria-label="Version note"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="What changed, and why"
                      autoFocus
                    />
                    <div className="flex justify-end">
                      <Button action="save" variant="primary" onClick={save.confirmAsk}>
                        Save version 3
                      </Button>
                    </div>
                  </>
                ),
              },
            },
          ]}
          trailing={<RemoveButton confirms label="Close this geolocation" />}
        />
      </Variant>
    </>
  );
}

export const EVENT: PaletteCategory = {
  id: "event",
  title: "Event",
  entries: [
    { entry: "EventShell", tier: "high", demo: <EventShellPreview /> },
    {
      entry: "MapPanelBody / eventPanelContent", tier: "high",
      demo: (
        <div className="w-[380px] max-w-full space-y-4">
          <MapPanelBody
            content={eventPanelContent({
              ...MOCK_DETAIL,
              detected_from_url: "https://x.com/analyst/status/1234567890",
            })}
          />
        </div>
      ),
    },
    { entry: "SourcesField / SourceEditor", tier: "high", demo: <PaletteSourcesField /> },
    { entry: "PublishActions", tier: "high", demo: <PalettePublishActions /> },
  ],
};
