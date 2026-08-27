import React from 'react';
import { X } from 'lucide-react';

export default function TagBadge({ tag, onRemove }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
      style={{ backgroundColor: tag.color + '22', borderColor: tag.color, color: tag.color }}
      onClick={e => e.stopPropagation()}
    >
      {tag.emoji && <span>{tag.emoji}</span>}
      {tag.name}
      {onRemove && (
        <button
          onClick={() => onRemove(tag.id)}
          className="ml-0.5 transition-opacity hover:opacity-70"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}
