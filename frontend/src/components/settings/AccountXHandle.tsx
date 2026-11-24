import { FieldLabel } from "@/components/ui/FieldLabel";

/** The Account card's X handle row: the bound handle from `/auth/me`, read-only. Only an admin
 *  writes it. */
export function AccountXHandle({ xHandle }: { xHandle: string | null }) {
  return (
    <div className="space-y-3 border-t border-neutral-800 pt-4 text-sm">
      <div>
        <FieldLabel label="X handle" concept="x_handle" />
        <p className={`mt-0.5 ${xHandle ? "text-neutral-100" : "text-neutral-500"}`}>
          {xHandle ? `@${xHandle}` : "No X handle linked"}
        </p>
      </div>
    </div>
  );
}
