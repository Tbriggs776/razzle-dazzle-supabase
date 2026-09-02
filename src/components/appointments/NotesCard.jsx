import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from "@/components/ui/button";
import { Pencil, Check, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function NotesCard({ appointment, updateMutation }) {
  const [editingNotes, setEditingNotes] = useState(false);
  const [newNote, setNewNote] = useState('');

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.7 }}
      className="bg-white rounded-2xl border border-border p-6 md:col-span-2"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Notes
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditingNotes(!editingNotes)}
          className="text-xs bg-purple-50 text-purple-600 border-purple-200 hover:bg-purple-100"
        >
          <Pencil className="w-3 h-3 mr-1" />
          {editingNotes ? 'Cancel' : 'Add Note'}
        </Button>
      </div>

      {/* Existing Notes */}
      {appointment.notes && appointment.notes.length > 0 ? (
        <div className="space-y-3 mb-4">
          {appointment.notes.map((note, index) => (
            <div key={index} className="p-4 rounded-lg bg-muted border border-border">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 mb-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-purple-600">{note.context || 'Note'}</span>
                  <span className="text-xs text-muted-foreground">•</span>
                  <span className="text-xs text-muted-foreground">{note.user_name}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(note.timestamp).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                  })}
                </span>
              </div>
              <p className="text-foreground whitespace-pre-wrap">{note.content}</p>
            </div>
          ))}
        </div>
      ) : !editingNotes && (
        <p className="text-muted-foreground text-center py-6 mb-4">No notes yet</p>
      )}

      {/* Add New Note */}
      {editingNotes && (
        <div className="space-y-4">
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            className="w-full p-4 border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            rows="4"
            placeholder="Add a new note..."
          />
          <div className="flex gap-3 justify-end">
            <Button
              variant="outline"
              onClick={() => {
                setEditingNotes(false);
                setNewNote('');
              }}
              className="border-border"
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                const user = await base44.auth.me();
                const existingNotes = appointment.notes || [];
                await updateMutation.mutateAsync({
                  notes: [
                    ...existingNotes,
                    {
                      content: newNote,
                      user_name: user.full_name,
                      user_email: user.email,
                      timestamp: new Date().toISOString(),
                      context: 'General Note'
                    }
                  ]
                });
                setEditingNotes(false);
                setNewNote('');
              }}
              disabled={updateMutation.isPending || !newNote.trim()}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Add Note
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </motion.div>
  );
}