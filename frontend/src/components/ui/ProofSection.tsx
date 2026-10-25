import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/Card";
import { FORM_INVALID_FIELD } from "@/components/ui/form-styles";

// The proof's card on the event page and in every event form: `<Card>` one density step tighter
// (p-4), a reading surface. Holding the form's editor, it takes the field's focus border and,
// when a publish flags the proof, its red outline.
export function ProofSection({
  invalid = false,
  editor = false,
  children,
}: {
  invalid?: boolean;
  /** Holds the proof editor: the card is the field's frame. */
  editor?: boolean;
  children: ReactNode;
}) {
  return (
    <Card
      className={cn(
        "p-4",
        editor && "focus-within:border-orange-500",
        invalid && FORM_INVALID_FIELD,
      )}
    >
      {children}
    </Card>
  );
}
