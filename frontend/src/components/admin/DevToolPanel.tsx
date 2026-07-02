import type { ReactNode } from "react";

import { SectionEyebrow } from "@/components/ui/SectionEyebrow";

/**
 * The dev-tool panel shell (seed/wipe, maintenance): deliberately lighter
 * than the `<Card as="section">` the real admin actions use (translucent
 * background, bordered header), so dev tooling reads as a separate register
 * on the admin page. Named once here; the look is not to be re-rolled.
 */
export function DevToolPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border border-neutral-800 rounded-lg bg-neutral-900/50">
      <header className="px-4 py-3 border-b border-neutral-800">
        <SectionEyebrow title={title} margin="none" />
        <p className="text-xs text-neutral-500 mt-0.5">{description}</p>
      </header>
      <div className="px-4 py-3 space-y-3">{children}</div>
    </section>
  );
}
