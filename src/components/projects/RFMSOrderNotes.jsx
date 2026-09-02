import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { invokeFailure } from '@/lib/invokeResult';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, StickyNote, RefreshCw, Plus } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const noteTypeLabels = {
  publicNotes: 'Public Notes',
  privateNotes: 'Private Notes',
  workOrderNotes: 'Work Order Notes'
};

const noteTypeColors = {
  publicNotes: 'border-border text-muted-foreground',
  privateNotes: 'border-warn/25 text-warn',
  workOrderNotes: 'border-info/25 text-info'
};

export default function RFMSOrderNotes({ invoiceNumber, currentUser }) {
  const queryClient = useQueryClient();
  const [noteType, setNoteType] = useState('privateNotes');
  const [noteText, setNoteText] = useState('');
  const [appending, setAppending] = useState(false);
  const [appendError, setAppendError] = useState('');

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['rfmsOrderNotes', invoiceNumber],
    queryFn: async () => {
      const res = await base44.functions.invoke('getRFMSOrderNotes', { documentNumber: invoiceNumber });
      if (data?.error) throw new Error(data.error);
      // Was `const { data } = ...` with no check: on failure data is
      // null and this threw a TypeError, or silently returned [].
      const failed = invokeFailure(res);
      if (failed) throw new Error(failed);
      const data = res.data;
      return data;
    },
    retry: 0,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false
  });

  if (!invoiceNumber) return null;

  const hasNotes = data && (data.publicNotes || data.privateNotes || data.workOrderNotes || (data.lineNotes && data.lineNotes.length > 0));

  const handleAppendNote = async () => {
    if (!noteText.trim()) return;
    setAppending(true);
    setAppendError('');
    try {
      const { data: result } = await base44.functions.invoke('appendRFMSOrderNotes', {
        documentNumber: invoiceNumber,
        noteType,
        noteText: noteText.trim()
      });
      if (!result?.success) throw new Error(result?.error || 'Failed to append note');
      setNoteText('');
      await refetch();
    } catch (err) {
      setAppendError(err.message || 'Failed to append note');
    } finally {
      setAppending(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-border p-6 md:col-span-2">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <StickyNote className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            RFMS Order Notes (Live)
          </h2>
        </div>
        <Button
          onClick={() => refetch()}
          disabled={isFetching}
          variant="outline"
          size="sm"
          className="border-info/25 text-info hover:bg-info/12"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 text-info animate-spin" />
        </div>
      ) : error ? (
        <p className="text-sm text-crit text-center py-4">Failed to load RFMS notes: {error.message}</p>
      ) : !hasNotes ? (
        <p className="text-sm text-muted-foreground text-center py-4">No notes found on RFMS order #{invoiceNumber}</p>
      ) : (
        <div className="space-y-4">
          {data.publicNotes && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Public Notes</p>
              <div className="bg-muted rounded-lg p-3 text-sm text-foreground prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: data.publicNotes }} />
            </div>
          )}
          {data.privateNotes && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Private Notes</p>
              <div className="bg-warn/12 rounded-lg p-3 text-sm text-foreground prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: data.privateNotes }} />
            </div>
          )}
          {data.workOrderNotes && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Work Order Notes</p>
              <div className="bg-info/12 rounded-lg p-3 text-sm text-foreground prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: data.workOrderNotes }} />
            </div>
          )}
          {data.lineNotes && data.lineNotes.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Line Item Notes</p>
              <div className="space-y-2">
                {data.lineNotes.map((line, idx) => (
                  <div key={idx} className="bg-muted rounded-lg p-3">
                    <p className="text-xs font-semibold text-muted-foreground mb-1">Line {line.lineNumber} — {line.styleName}</p>
                    <div className="text-sm text-foreground prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: line.notes }} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Append Note Box */}
      <div className="mt-6 pt-4 border-t border-border">
        <div className="flex items-center gap-2 mb-3">
          <Plus className="w-4 h-4 text-info" />
          <h3 className="text-sm font-medium text-muted-foreground">Append Note to RFMS</h3>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Note type:</span>
            <Select value={noteType} onValueChange={setNoteType}>
              <SelectTrigger className={`h-8 text-xs w-48 ${noteTypeColors[noteType]}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(noteTypeLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value} className="text-xs">{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Textarea
            placeholder="Type your note here..."
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={3}
            className="text-sm"
          />
          <p className="text-[11px] text-muted-foreground">
            Your name and timestamp will be added automatically: [{currentUser?.full_name || currentUser?.email || 'Your Name'} - now]
          </p>
          {appendError && (
            <p className="text-xs text-crit">{appendError}</p>
          )}
          <Button
            onClick={handleAppendNote}
            disabled={appending || !noteText.trim()}
            size="sm"
            className="bg-info hover:bg-info"
          >
            {appending ? (
              <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Appending...</>
            ) : (
              <><Plus className="w-3 h-3 mr-1" />Append Note</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}