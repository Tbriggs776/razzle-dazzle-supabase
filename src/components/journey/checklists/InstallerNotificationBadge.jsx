import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { invokeFailure } from '@/lib/invokeResult';
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
      // On a transport failure res.data is null, which left `result` null — and the
      // badge's own fallback then read "Installer notification sent". Pressing
      // Resend and being told it sent is the exact failure this badge exists to
      // prevent.
      const failed = invokeFailure(res);
      setResult(failed ? { error: failed } : res.data);
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
      <div className="flex items-center gap-1.5 text-xs text-info">
        <Bell className="w-3.5 h-3.5" />
        <span>
          {result?.error
            ? result.error
            : result?.success
              // Neither channel firing is the live state whenever the email/SMS
              // credentials are absent, and it used to render as a bare
              // "Notification sent to <crew>" with no channel after it.
              ? (!result.emailSent && !result.smsSent
                  ? `Nothing was sent to ${result.installer} — no email or SMS channel is set up`
                  : `Notification sent to ${result.installer}${result.emailSent ? ' (email)' : ''}${result.smsSent ? ' + (SMS)' : ''}`)
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
        className="h-6 px-2 py-0 text-xs gap-1 border-info/30 text-info hover:bg-info/10"
      >
        {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        Resend
      </Button>
    </div>
  );
}