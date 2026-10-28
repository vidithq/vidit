import { Button } from "@/components/ui/Button";
import { CharCounter } from "@/components/ui/CharCounter";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { Input } from "@/components/ui/Input";
import { VERSION_NOTE_MAX_LEN } from "@/lib/events";

/** The panel the first click on **Save version N** opens, on an event and on a site: the optional
 *  note the version keeps, then the save. Enter in the note saves; the panel's Escape or an
 *  outside click writes nothing. */
export function VersionNotePanel({
  note,
  setNote,
  saveLabel,
  onSave,
}: {
  note: string;
  setNote: (note: string) => void;
  saveLabel: string;
  onSave: () => void;
}) {
  return (
    <>
      <div className="space-y-1.5 px-1">
        <FieldLabel
          label="Version note"
          concept="version_note"
          htmlFor="version_note"
          trailing={<CharCounter length={note.length} max={VERSION_NOTE_MAX_LEN} />}
        />
        <Input
          id="version_note"
          type="text"
          value={note}
          maxLength={VERSION_NOTE_MAX_LEN}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            onSave();
          }}
          placeholder="What changed, and why"
          autoFocus
        />
      </div>
      <div className="flex justify-end">
        <Button action="save" variant="primary" onClick={onSave}>
          {saveLabel}
        </Button>
      </div>
    </>
  );
}
