import { useId, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { ICON_TAP_STEP } from "./Button";
import { LABEL_TEXT } from "./form-styles";
import { Switch } from "./Switch";
import { PreferenceText } from "./ToggleRow";

type ToggleMatrixColumn<C extends string> = { id: C; label: string };

type ToggleMatrixRow<R extends string, C extends string> = {
  id: R;
  label: string;
  description?: ReactNode;
  /** State per column id; a missing column reads off. */
  on: Partial<Record<C, boolean>>;
  /** Column id to the reason that cell refuses the toggle. */
  disabled?: Partial<Record<C, string>>;
};

/** One fixed width per column, so the headers and every row's switches line up without a
 *  table and the switches stay on the row at 320px. Fits a one-word header. */
const COLUMN = "w-12 shrink-0 flex justify-center";

/** Several booleans per row: one `<ToggleRow>`-shaped label on the left, one switch per
 *  column on the right, the column headers once at the top. Each switch is its own button
 *  (36px square, the `<Switch>` as its visual span) named "<row>, <column>". A disabled
 *  cell keeps its state, leaves the tab order and is described by its reason, which the
 *  matrix prints once under the rows however many cells share it. */
export function ToggleMatrix<R extends string, C extends string>({
  columns,
  rows,
  onToggle,
}: {
  columns: readonly ToggleMatrixColumn<C>[];
  rows: readonly ToggleMatrixRow<R, C>[];
  onToggle: (rowId: R, columnId: C, next: boolean) => void;
}) {
  const baseId = useId();
  const reasons = [
    ...new Set(rows.flatMap((row) => columns.flatMap((column) => row.disabled?.[column.id] ?? []))),
  ];
  const reasonId = (reason: string) => `${baseId}-reason-${reasons.indexOf(reason)}`;

  return (
    <div>
      <div className="flex items-end gap-2" aria-hidden="true">
        <span className="flex-1" />
        {columns.map((column) => (
          <span key={column.id} className={cn(COLUMN, LABEL_TEXT)}>
            {column.label}
          </span>
        ))}
      </div>
      {rows.map((row, i) => {
        const descriptionId = `${baseId}-description-${i}`;
        return (
          <div
            key={row.id}
            className={cn("flex items-center gap-2 py-2", i > 0 && "border-t border-neutral-800")}
          >
            <PreferenceText
              label={row.label}
              description={row.description}
              descriptionId={descriptionId}
            />
            {columns.map((column) => {
              const on = row.on[column.id] ?? false;
              const reason = row.disabled?.[column.id];
              const describedBy = [
                row.description !== undefined && descriptionId,
                reason !== undefined && reasonId(reason),
              ].filter(Boolean);
              return (
                <span key={column.id} className={COLUMN}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`${row.label}, ${column.label}`}
                    aria-describedby={describedBy.join(" ") || undefined}
                    disabled={reason !== undefined}
                    onClick={() => onToggle(row.id, column.id, !on)}
                    className={cn(ICON_TAP_STEP, "flex items-center justify-center")}
                  >
                    <Switch as="span" on={on} disabled={reason !== undefined} />
                  </button>
                </span>
              );
            })}
          </div>
        );
      })}
      {reasons.map((reason) => (
        <p key={reason} id={reasonId(reason)} className="text-xs text-neutral-500">
          {reason}
        </p>
      ))}
    </div>
  );
}
