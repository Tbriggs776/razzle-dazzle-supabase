import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2, Plus, Loader2 } from 'lucide-react';

export default function TagManager() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#6366F1');
  const [newEmoji, setNewEmoji] = useState('');

  const { data: tags = [], isLoading } = useQuery({
    queryKey: ['tags'],
    queryFn: () => base44.entities.Tag.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Tag.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setNewName('');
      setNewColor('#6366F1');
      setNewEmoji('');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Tag.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tags'] })
  });

  const handleCreate = () => {
    if (!newName.trim()) return;
    createMutation.mutate({ name: newName.trim(), color: newColor, emoji: newEmoji.trim() });
  };

  return (
    <div className="space-y-4">
      {/* Existing Tags */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading tags...</div>
      ) : tags.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tags created yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.map(tag => (
            <div
              key={tag.id}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium"
              style={{ backgroundColor: tag.color + '22', borderColor: tag.color, color: tag.color }}
            >
              {tag.emoji && <span>{tag.emoji}</span>}
              <span>{tag.name}</span>
              <button
                onClick={() => deleteMutation.mutate(tag.id)}
                className="ml-1 hover:opacity-70 transition-opacity"
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Create New Tag */}
      <div className="flex items-center gap-2 pt-2 border-t border-border flex-wrap">
        <Input
          value={newEmoji}
          onChange={e => setNewEmoji(e.target.value)}
          placeholder="Emoji"
          className="w-20"
          maxLength={4}
        />
        <Input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Tag name"
          className="w-40"
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
        />
        <input
          type="color"
          value={newColor}
          onChange={e => setNewColor(e.target.value)}
          className="w-10 h-9 rounded-md border border-border cursor-pointer"
          title="Pick color"
        />
        <Button
          onClick={handleCreate}
          disabled={!newName.trim() || createMutation.isPending}
          className="bg-info hover:bg-info"
          size="sm"
        >
          {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4 mr-1" />Add Tag</>}
        </Button>
      </div>
    </div>
  );
}