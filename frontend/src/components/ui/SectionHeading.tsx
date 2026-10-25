/** Form-section heading inside the section's card: an `h2` with the section's title. */
export function SectionHeading({ title }: { title: string }) {
  return <h2 className="text-sm font-medium text-neutral-200">{title}</h2>;
}
