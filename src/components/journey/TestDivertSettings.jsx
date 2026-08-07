import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Mail, Phone, Loader2, AlertTriangle, Users, HardHat } from 'lucide-react';
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
        customer_divert_phone: custPhone
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
        <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {enabled && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700">
            <strong>Full Test Divert is ON</strong> — every Journey checkpoint notification (FM, installer, customer, coordinator) will be sent to the email and phone below instead of real recipients. This overrides the customer-only divert below. Turn off before going live.
          </p>
        </div>
      )}
      {custEnabled && !enabled && (
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
          <Users className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700">
            <strong>Customer Divert is ON</strong> — customer-facing Journey notifications will be sent to the email and phone below. Installer (crew) and field manager notifications still go to the real assigned recipients.
          </p>
        </div>
      )}

      {/* Full Test Divert */}
      <div className="space-y-4 border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-start gap-2">
            <FlaskConical className="w-4 h-4 text-slate-700 mt-0.5" />
            <div>
              <Label className="text-sm font-medium text-slate-700">Enable Full Test Divert</Label>
              <p className="text-xs text-slate-500">Route ALL checkpoint notifications (FM, installer, customer, coordinator) to a single test email + phone</p>
            </div>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500 flex items-center gap-1.5">
              <Mail className="w-3 h-3" /> Test Email
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
            <Label className="text-xs text-slate-500 flex items-center gap-1.5">
              <Phone className="w-3 h-3" /> Test Phone
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
      <div className="space-y-4 border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-start gap-2">
            <Users className="w-4 h-4 text-slate-700 mt-0.5" />
            <div>
              <Label className="text-sm font-medium text-slate-700">Enable Customer-Only Divert</Label>
              <p className="text-xs text-slate-500">Route ONLY customer notifications to a test email + phone. Installer & field manager notifications go to the real assigned recipients.</p>
            </div>
          </div>
          <Switch checked={custEnabled} onCheckedChange={setCustEnabled} />
        </div>

        <div className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
          <HardHat className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
          <p className="text-xs text-slate-500">
            When this is on, installers and field managers still receive their real notifications. Only customer messages ("installation underway", "floor prep complete", "nearing completion", "installation complete") are diverted.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500 flex items-center gap-1.5">
              <Mail className="w-3 h-3" /> Customer Divert Email
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
            <Label className="text-xs text-slate-500 flex items-center gap-1.5">
              <Phone className="w-3 h-3" /> Customer Divert Phone
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
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
          Save Divert Settings
        </Button>
      </div>
    </div>
  );
}