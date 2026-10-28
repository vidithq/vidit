"use client";

import { useApiResource } from "@/hooks/useApiResource";
import { MY_X_HANDLE_PATH, type XHandleState } from "@/lib/xHandle";
import { FORM_LABEL } from "@/components/ui/form-styles";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

/** The Account card's X handle row: the bound handle, read-only. Only an admin writes it. */
export function AccountXHandle() {
  const { data, error } = useApiResource<XHandleState>(MY_X_HANDLE_PATH);
  const bound = data?.x_handle ?? null;

  return (
    <div className="space-y-3 border-t border-neutral-800 pt-4 text-sm">
      <div>
        <span className={FORM_LABEL}>X handle</span>
        <p className={`mt-0.5 ${bound ? "text-neutral-100" : "text-neutral-500"}`}>
          {bound ? `@${bound}` : "No X handle linked"}
        </p>
        <p className="text-xs text-neutral-500 mt-1">
          The Vidit bot and the archive import credit posts from this handle to your
          account. An admin links it.
        </p>
      </div>
      {error && <ErrorNotice error={error} />}
    </div>
  );
}
