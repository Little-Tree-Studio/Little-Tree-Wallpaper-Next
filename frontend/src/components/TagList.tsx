interface TagListProps {
  tags: string[];
  max?: number;
  className?: string;
}

export default function TagList({ tags, max = 3, className = '' }: TagListProps) {
  if (!tags || tags.length === 0) return null;

  const visible = tags.slice(0, max);
  const remaining = tags.length - max;

  return (
    <div className={`flex min-w-0 items-center gap-1 overflow-hidden ${className}`}>
      {visible.map((tag) => (
        <span
          key={tag}
          title={tag}
          className="inline-flex h-4 max-w-[100px] shrink-0 items-center rounded-full bg-surface-secondary px-1.5 text-[10px] leading-none text-foreground"
        >
          <span className="truncate">{tag}</span>
        </span>
      ))}
      {remaining > 0 && (
        <span className="inline-flex h-4 shrink-0 items-center rounded-full bg-surface-secondary px-1.5 text-[10px] leading-none text-muted">
          +{remaining}
        </span>
      )}
    </div>
  );
}
