"use client";

import { useAuth } from "@/contexts/AuthContext";
import { FieldLabel } from "@/components/ui/FieldLabel";

/** The Account card's X handle row: the bound handle, read-only. Only an admin writes it. */
export function AccountXHandle() {
  const bound = useAuth().user?.x_handle ?? null;

  return (
    <div className="space-y-3 border-t border-neutral-800 pt-4 text-sm">
      <div>
        <FieldLabel label="X handle" concept="x_handle" />
        <p className={`mt-0.5 ${bound ? "text-neutral-100" : "text-neutral-500"}`}>
          {bound ? `@${bound}` : "No X handle linked"}
        </p>
      </div>
    </div>
  );
}
