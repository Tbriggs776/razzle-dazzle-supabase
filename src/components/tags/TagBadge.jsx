import React from 'react';
import { X } from 'lucide-react';

export default function TagBadge({ tag, onRemove }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border"
      style={{ backgroundColor: tag.color + '22', borderColor: tag.color, color: tag.color }}
      onClick={e => e.stopPropagation()}
    >
      {tag.emoji && <span>{tag.emoji}</span>}
      {tag.name}
      {onRemove && (
        <button
          onClick={() => onRemove(tag.id)}
          className="hover:opacity-70 transition-opacity ml-0.5"
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </span>
  );
}