import { TEXT_LINK, WARNING_CALLOUT } from "@/components/ui/styles";

// Amber "couldn't load the curated Conflict/Capture tags" banner with a retry,
// shown identically by the submit form and the detection edit form.
export function CuratedTagsError({
  onRetry,
  message = "Couldn't load the required Conflict and Capture source options.",
}: {
  onRetry: () => void;
  message?: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm ${WARNING_CALLOUT}`}>
      <span>{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className={`shrink-0 font-medium ${TEXT_LINK}`}
      >
        Retry
      </button>
    </div>
  );
}
