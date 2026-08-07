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
                ? "bg-indigo-100 border-indigo-300 text-indigo-700" 
                : "bg-slate-50 border-slate-200 hover:bg-slate-100"
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
          className="h-7 px-2 text-xs border-slate-200 hover:bg-slate-100"
        >
          <Smile className="w-3 h-3" />
        </Button>
        
        {showEmojiPicker && (
          <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg p-2 flex gap-1 z-10">
            {EMOJI_OPTIONS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleAddReaction(emoji)}
                className="text-lg p-1 hover:bg-slate-100 rounded transition-colors"
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