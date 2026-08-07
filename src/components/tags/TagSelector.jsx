import React, { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Tag, ChevronDown } from 'lucide-react';
import TagBadge from './TagBadge';

export default function TagSelector({ selectedTagIds = [], onChange, className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const { data: allTags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: () => base44.entities.Tag.list(),
    staleTime: 60000
  });

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selectedTags = allTags.filter(t => selectedTagIds.includes(t.id));
  const unselectedTags = allTags.filter(t => !selectedTagIds.includes(t.id));

  const toggleTag = (tagId) => {
    const next = selectedTagIds.includes(tagId)
      ? selectedTagIds.filter(id => id !== tagId)
      : [...selectedTagIds, tagId];
    onChange(next);
  };

  return (
    <div className={`relative ${className}`} ref={ref}>
      <div
        className="min-h-9 flex flex-wrap gap-1.5 items-center px-3 py-1.5 border border-slate-200 rounded-lg bg-white cursor-pointer hover:border-indigo-300 transition-colors"
        onClick={() => setOpen(!open)}
      >
        {selectedTags.length === 0 && (
          <span className="flex items-center gap-1.5 text-sm text-slate-400">
            <Tag className="w-3.5 h-3.5" />
            Add tags...
          </span>
        )}
        {selectedTags.map(tag => (
          <TagBadge
            key={tag.id}
            tag={tag}
            onRemove={(id) => toggleTag(id)}
          />
        ))}
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-auto flex-shrink-0" />
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
          {allTags.length === 0 && (
            <div className="px-3 py-3 text-sm text-slate-400 text-center">No tags configured yet</div>
          )}
          {allTags.map(tag => {
            const selected = selectedTagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                onClick={() => toggleTag(tag.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 transition-colors ${selected ? 'bg-slate-50' : ''}`}
              >
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: tag.color }}
                />
                <span className="text-sm flex-1">{tag.emoji} {tag.name}</span>
                {selected && <span className="text-xs text-indigo-600 font-medium">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}