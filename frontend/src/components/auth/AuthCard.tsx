import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface AuthCardProps {
  icon?: LucideIcon;
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Centered closing line (copy and links, e.g. "Back to sign in"). For several lines or custom
   * sizing, render children instead (see LoginForm). */
  footer?: ReactNode;
  children?: ReactNode;
}

/** Card shell shared by every `(auth)` surface: one home for the max-w-sm dark-card treatment. */
export function AuthCard({
  icon: Icon,
  title,
  subtitle,
  footer,
  children,
}: AuthCardProps) {
  const header = title != null && (
    <div>
      <h1 className="text-lg font-medium text-neutral-100">{title}</h1>
      {subtitle != null && (
        <p className="text-xs text-neutral-400 mt-1">{subtitle}</p>
      )}
    </div>
  );

  return (
    <div className="w-full max-w-sm space-y-5 bg-neutral-900 border border-neutral-800 rounded-lg p-6 shadow-2xl">
      {header &&
        (Icon ? (
          <div className="flex items-start gap-3">
            <Icon size={20} className="text-orange-400 shrink-0 mt-1" />
            {header}
          </div>
        ) : (
          header
        ))}
      {children}
      {footer != null && (
        <p className="text-center text-xs text-neutral-400">{footer}</p>
      )}
    </div>
  );
}
