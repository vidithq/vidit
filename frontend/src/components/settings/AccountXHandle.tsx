"use client";

import { useApiResource } from "@/hooks/useApiResource";
import { MY_X_HANDLE_PATH, type XHandleState } from "@/lib/xHandle";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";

/** The Account card's X handle row: the bound handle, read-only. Only an admin writes it. */
export function AccountXHandle() {
  const { data, error } = useApiResource<XHandleState>(MY_X_HANDLE_PATH);
  const bound = data?.x_handle ?? null;

  return (
    <div className="space-y-3 border-t border-neutral-800 pt-4 text-sm">
      <div>
        <FieldLabel label="X handle" concept="x_handle" />
        <p className={`mt-0.5 ${bound ? "text-neutral-100" : "text-neutral-500"}`}>
          {bound ? `@${bound}` : "No X handle linked"}
        </p>
      </div>
      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}
    </div>
  );
}
