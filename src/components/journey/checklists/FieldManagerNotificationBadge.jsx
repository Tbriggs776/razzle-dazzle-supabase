import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Bell, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function FieldManagerNotificationBadge({ checkpoint }) {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const handleResend = async () => {
    setSending(true);
    setResult(null);
    try {
      const res = await base44.functions.invoke('submitCheckpoint', {
        action: 'resend_notification',
        checkpoint_id: checkpoint?.id,
      });
      setResult(res.data);
    } catch (e) {
      console.error('Resend notification failed', e);
      setResult({ error: e.message || 'Failed to resend' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex items-center gap-2 mt-2 ml-8">
      <div className="flex items-center gap-1.5 text-xs text-warn">
        <Bell className="w-3.5 h-3.5" />
        <span>
          {result?.error
            ? result.error
            : result?.success
              ? `Notification sent to ${result.fieldManager}${result.emailSent ? ' (email)' : ''}${result.smsSent ? ' + (SMS)' : ''}`
              : 'Notification sent to field manager'}
        </span>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={handleResend}
        disabled={sending}
        className="h-6 px-2 py-0 text-xs gap-1 border-warn/30 text-warn hover:bg-warn/10"
      >
        {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        Resend
      </Button>
    </div>
  );
}