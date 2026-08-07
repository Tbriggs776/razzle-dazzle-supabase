import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Bell, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function InstallerNotificationBadge({ checkpoint }) {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const handleResend = async () => {
    setSending(true);
    setResult(null);
    try {
      const res = await base44.functions.invoke('submitCheckpoint', {
        action: 'resend_installer_notification',
        checkpoint_id: checkpoint?.id,
      });
      setResult(res.data);
    } catch (e) {
      console.error('Resend installer notification failed', e);
      setResult({ error: e.message || 'Failed to resend' });
    } finally {
      setSending(false);
    }
  };

  const notifiedDate = checkpoint?.checklist_data?.installer_notified_date;
  const installerName = checkpoint?.checklist_data?.installer_notified_name;

  return (
    <div className="flex items-center gap-2 mt-2 ml-8">
      <div className="flex items-center gap-1.5 text-xs text-blue-600">
        <Bell className="w-3.5 h-3.5" />
        <span>
          {result?.error
            ? result.error
            : result?.success
              ? `Notification sent to ${result.installer}${result.emailSent ? ' (email)' : ''}${result.smsSent ? ' + (SMS)' : ''}`
              : notifiedDate
                ? `Installer notified: ${installerName || ''} on ${new Date(notifiedDate).toLocaleString()}`
                : 'Installer notification sent'}
        </span>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={handleResend}
        disabled={sending}
        className="h-6 px-2 py-0 text-xs gap-1 border-blue-200 text-blue-700 hover:bg-blue-50"
      >
        {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        Resend
      </Button>
    </div>
  );
}