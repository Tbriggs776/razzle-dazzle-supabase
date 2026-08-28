import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Mail, Phone, Loader2, AlertTriangle, Users, HardHat, Radio, Moon } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export default function TestDivertSettings() {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [email, setEmail] = useState('user7@example.com');
  const [phone, setPhone] = useState('5555550100');
  const [custEnabled, setCustEnabled] = useState(false);
  const [custEmail, setCustEmail] = useState('user7@example.com');
  const [custPhone, setCustPhone] = useState('5555550100');
  // Safety rails — enforced server-side in sendMessage, configured here.
  const [outbound, setOutbound] = useState(false);
  const [quietEnabled, setQuietEnabled] = useState(true);
  const [quietStart, setQuietStart] = useState('20:00');
  const [quietEnd, setQuietEnd] = useState('08:00');
  const [saving, setSaving] = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['smsSettings'],
    queryFn: async () => {
      const list = await base44.entities.SMSSettings.list();
      return list[0] || null;
    }
  });

  // Sync local form state from the loaded settings (React Query v5 dropped useQuery onSuccess)
  React.useEffect(() => {
    if (settings) {
      setEnabled(settings.test_divert_enabled || false);
      setEmail(settings.test_divert_email || 'user7@example.com');
      setPhone(settings.test_divert_phone || '5555550100');
      setCustEnabled(settings.customer_divert_enabled || false);
      setCustEmail(settings.customer_divert_email || 'user7@example.com');
      setCustPhone(settings.customer_divert_phone || '5555550100');
      setOutbound(settings.sms_outbound_enabled === true);
      setQuietEnabled(settings.quiet_hours_enabled !== false);
      setQuietStart(settings.quiet_hours_start || '20:00');
      setQuietEnd(settings.quiet_hours_end || '08:00');
    }
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        test_divert_enabled: enabled,
        test_divert_email: email,
        test_divert_phone: phone,
        customer_divert_enabled: custEnabled,
        customer_divert_email: custEmail,
        customer_divert_phone: custPhone,
        sms_outbound_enabled: outbound,
        quiet_hours_enabled: quietEnabled,
        quiet_hours_start: quietStart,
        quiet_hours_end: quietEnd
      };
      if (settings?.id) {
        await base44.entities.SMSSettings.update(settings.id, payload);
      } else {
        await base44.entities.SMSSettings.create(payload);
      }
      queryClient.invalidateQueries({ queryKey: ['smsSettings'] });
    } catch (e) {
      console.error('Failed to save divert settings:', e);
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Outbound SMS master switch ───────────────────────────────────────
          Enforced in sendMessage, the single choke point every message passes
          through. Off means nothing sends, no matter which cron fires. */}
      <div className="space-y-4 rounded-xl border border-border p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-2">
            <Radio className="mt-0.5 h-4 w-4 text-foreground" />
            <div>
              <Label className="text-sm font-medium">Outbound SMS</Label>
              <p className="text-xs text-muted-foreground">
                Master switch for every outbound text. While this is off, all sends are logged and skipped — including scheduled reminders and follow-ups.
              </p>
            </div>
          </div>
          <Switch checked={outbound} onCheckedChange={setOutbound} />
        </div>

        {outbound ? (
          <div className="flex items-start gap-2 rounded-lg border border-crit/25 bg-crit/10 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-crit" />
            <p className="text-xs text-crit">
              <strong>Outbound SMS is ARMED.</strong> Scheduled reminders, follow-ups and alerts will send to real phone numbers as soon as Twilio is configured. Make sure divert is set the way you want it before leaving this on.
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted p-3">
            <Radio className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              Disarmed. Nothing will text a customer. Turn this on deliberately when you are ready to go live.
            </p>
          </div>
        )}
      </div>

      {/* ── Quiet hours ─────────────────────────────────────────────────────── */}
      <div className="space-y-4 rounded-xl border border-border p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-2">
            <Moon className="mt-0.5 h-4 w-4 text-foreground" />
            <div>
              <Label className="text-sm font-medium">Quiet hours</Label>
              <p className="text-xs text-muted-foreground">
                Customer texts outside these hours are held and delivered when quiet hours end — not dropped. Internal staff alerts are exempt, so a safety hard-stop still reaches someone at 2am.
              </p>
            </div>
          </div>
          <Switch checked={quietEnabled} onCheckedChange={setQuietEnabled} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Start (no texts after)</Label>
            <Input type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} disabled={!quietEnabled} className="text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">End (texts resume)</Label>
            <Input type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} disabled={!quietEnabled} className="text-sm" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground/80">Arizona time.</p>
      </div>

      {enabled && (
        <div className="flex items-start gap-2 rounded-lg border border-warn/25 bg-warn/10 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          <p className="text-xs text-warn">
            <strong>Full Test Divert is ON</strong> — every Journey checkpoint notification (FM, installer, customer, coordinator) will be sent to the email and phone below instead of real recipients. This overrides the customer-only divert below. Turn off before going live.
          </p>
        </div>
      )}
      {custEnabled && !enabled && (
        <div className="flex items-start gap-2 rounded-lg border border-info/25 bg-info/10 p-3">
          <Users className="mt-0.5 h-4 w-4 shrink-0 text-info" />
          <p className="text-xs text-info">
            <strong>Customer Divert is ON</strong> — customer-facing Journey notifications will be sent to the email and phone below. Installer (crew) and field manager notifications still go to the real assigned recipients.
          </p>
        </div>
      )}

      {/* Full Test Divert */}
      <div className="space-y-4 rounded-xl border border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-start gap-2">
            <FlaskConical className="mt-0.5 h-4 w-4 text-foreground" />
            <div>
              <Label className="text-sm font-medium">Enable Full Test Divert</Label>
              <p className="text-xs text-muted-foreground">Route ALL checkpoint notifications (FM, installer, customer, coordinator) to a single test email + phone</p>
            </div>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Mail className="h-3 w-3" /> Test Email
            </Label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={!enabled}
              placeholder="user7@example.com"
              className="text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Phone className="h-3 w-3" /> Test Phone
            </Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={!enabled}
              placeholder="5555550100"
              className="text-sm"
            />
          </div>
        </div>
      </div>

      {/* Customer-Only Divert */}
      <div className="space-y-4 rounded-xl border border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-start gap-2">
            <Users className="mt-0.5 h-4 w-4 text-foreground" />
            <div>
              <Label className="text-sm font-medium">Enable Customer-Only Divert</Label>
              <p className="text-xs text-muted-foreground">Route ONLY customer notifications to a test email + phone. Installer &amp; field manager notifications go to the real assigned recipients.</p>
            </div>
          </div>
          <Switch checked={custEnabled} onCheckedChange={setCustEnabled} />
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted p-2.5">
          <HardHat className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            When this is on, installers and field managers still receive their real notifications. Only customer messages (&quot;installation underway&quot;, &quot;floor prep complete&quot;, &quot;nearing completion&quot;, &quot;installation complete&quot;) are diverted.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Mail className="h-3 w-3" /> Customer Divert Email
            </Label>
            <Input
              value={custEmail}
              onChange={(e) => setCustEmail(e.target.value)}
              disabled={!custEnabled}
              placeholder="user7@example.com"
              className="text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Phone className="h-3 w-3" /> Customer Divert Phone
            </Label>
            <Input
              value={custPhone}
              onChange={(e) => setCustPhone(e.target.value)}
              disabled={!custEnabled}
              placeholder="5555550100"
              className="text-sm"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="sm" className="gap-2">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
          Save SMS Settings
        </Button>
      </div>
    </div>
  );
}
