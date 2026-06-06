interface WipBadgeProps {
  tooltip?: string;
  children?: React.ReactNode;
  className?: string;
}

export default function WipBadge({
  tooltip,
  children,
  className = "",
}: WipBadgeProps) {
  return (
    <span
      title={tooltip}
      className={`inline-flex items-center px-1.5 py-0.5 text-[10px] uppercase tracking-wider rounded bg-neutral-100 text-neutral-900 font-semibold select-none ${className}`}
    >
      {children ?? "Coming soon"}
    </span>
  );
}
