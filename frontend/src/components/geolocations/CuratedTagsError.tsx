import { WARNING_CALLOUT } from "@/components/ui/styles";
import { Button } from "@/components/ui/Button";

// Amber "couldn't load the curated tags" banner with a retry, shared by the submit
// and detection edit forms.
export function CuratedTagsError({
  onRetry,
  message = "Couldn't load the required Conflict and Capture source options.",
}: {
  onRetry: () => void;
  message?: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 rounded-md px-4 py-3 text-sm ${WARNING_CALLOUT}`}>
      <span>{message}</span>
      <Button variant="ghost" onClick={onRetry} className="shrink-0">
        Retry
      </Button>
    </div>
  );
}
