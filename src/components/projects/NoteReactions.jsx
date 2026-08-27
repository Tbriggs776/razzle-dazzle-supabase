import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Smile } from 'lucide-react';
import { cn } from '@/lib/utils';

const EMOJI_OPTIONS = ['👍', '❤️', '😂', '😮', '✅', '🔥', '🎉'];

export default function NoteReactions({ note, onReactionAdd, currentUserEmail }) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const handleAddReaction = (emoji) => {
    onReactionAdd(emoji);
    setShowEmojiPicker(false);
  };

  const handleRemoveReaction = (emoji) => {
    onReactionAdd(emoji, true);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 mt-3">
      {note.reactions?.map((reaction, idx) => {
        const userReacted = reaction.users?.includes(currentUserEmail);
        return (
          <Button
            key={idx}
            size="sm"
            variant="outline"
            onClick={() => handleRemoveReaction(reaction.emoji)}
            className={cn(
              "h-7 px-2 text-xs flex items-center gap-1",
              userReacted
                ? "bg-brand-pink/10 border-brand-pink/40 text-brand-pink hover:bg-brand-pink/15"
                : "bg-muted border-border text-foreground hover:bg-accent"
            )}
            title={`${reaction.users?.join(', ') || 'No reactions'}`}
          >
            <span>{reaction.emoji}</span>
            <span className="text-xs font-semibold">{reaction.users?.length || 0}</span>
          </Button>
        );
      })}

      <div className="relative">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          className="h-7 px-2 text-xs border-border text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Smile className="w-3 h-3" />
        </Button>

        {showEmojiPicker && (
          <div className="absolute top-full left-0 mt-1 bg-popover text-popover-foreground border border-border rounded-lg shadow-lg p-2 flex gap-1 z-10">
            {EMOJI_OPTIONS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleAddReaction(emoji)}
                className="text-lg p-1 hover:bg-accent rounded transition-colors"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
