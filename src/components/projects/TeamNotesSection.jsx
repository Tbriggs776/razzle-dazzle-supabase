import React from 'react';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from 'lucide-react';
import NoteReactions from './NoteReactions';

export default function TeamNotesSection({
  project,
  newNote,
  setNewNote,
  onAddNote,
  onAddReaction,
  currentUser,
  isLoading
}) {
  return (
    <div className="bg-white rounded-2xl border border-border p-6 md:col-span-2">
      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
        Team Notes
      </h2>
      <div className="space-y-4">
        {/* Add Note Form */}
        <div className="flex gap-3">
          <Textarea
            placeholder="Add a note..."
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            className="flex-1 h-20"
            rows={2}
          />
          <Button
            onClick={onAddNote}
            disabled={!newNote.trim() || isLoading}
            className="bg-info hover:bg-info self-end"
            size="sm"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              'Add'
            )}
          </Button>
        </div>

        {/* Notes List */}
        {project.notes && project.notes.length > 0 ? (
          <div className="space-y-3 pt-2 border-t border-border">
            {[...project.notes].reverse().map((note, idx) => {
              const reverseIndex = project.notes.length - 1 - idx;
              return (
                <div key={idx} className="p-3 rounded-lg bg-muted">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">{note.user_name}</p>
                      <p className="text-xs text-muted-foreground">{note.user_email}</p>
                    </div>
                    <p className="text-xs text-muted-foreground flex-shrink-0">
                      {new Date(note.timestamp).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                      })}
                    </p>
                  </div>
                  <p className="text-sm text-foreground whitespace-pre-wrap mb-2">{note.content}</p>
                  <NoteReactions
                    note={note}
                    onReactionAdd={(emoji, isRemoving) => onAddReaction(reverseIndex, emoji, isRemoving)}
                    currentUserEmail={currentUser?.email}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">No notes yet</p>
        )}
      </div>
    </div>
  );
}