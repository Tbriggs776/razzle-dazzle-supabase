import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Compass, Loader2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

export default function JourneyNavToggle() {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ['appSettings'],
    queryFn: async () => {
      const list = await base44.entities.AppSettings.list();
      return list[0] || null;
    }
  });

  useEffect(() => {
    if (settings) {
      setEnabled(settings.journey_nav_item_enabled !== false);
    }
  }, [settings]);

  const handleSave = async (value) => {
    setSaving(true);
    try {
      const payload = { journey_nav_item_enabled: value };
      if (settings?.id) {
        await base44.entities.AppSettings.update(settings.id, payload);
      } else {
        await base44.entities.AppSettings.create(payload);
      }
      queryClient.invalidateQueries({ queryKey: ['appSettings'] });
    } catch (e) {
      console.error('Failed to save Journey nav setting:', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-start gap-2">
        <Compass className="w-4 h-4 text-slate-700 mt-0.5" />
        <div>
          <Label className="text-sm font-medium text-slate-700">Show Journey Menu Item</Label>
          <p className="text-xs text-slate-500">Toggle off to hide the Journey navigation item for admins.</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {saving && <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" />}
        <Switch
          checked={enabled}
          onCheckedChange={(v) => {
            setEnabled(v);
            handleSave(v);
          }}
        />
      </div>
    </div>
  );
}