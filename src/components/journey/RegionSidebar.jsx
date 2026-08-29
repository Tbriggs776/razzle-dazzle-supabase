import React, { useState } from 'react';
import { Plus, Pencil, Trash2, Check, X, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/lib/i18n/LanguageContext';

// Deliberately literal hex, not design tokens: these are DATA. The chosen value is
// persisted to RegionAssignment.color and handed to Leaflet to fill the polygon on the
// map, which cannot resolve CSS vars. They are region identity, not theme surface.
const REGION_COLORS = [
  '#4F46E5', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444',
  '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1'
];

function RegionForm({ region, teamMembers, crews = [], onSave, onCancel }) {
  const { t } = useLanguage();
  const [form, setForm] = useState({
    region_name: region?.region_name || '',
    color: region?.color || REGION_COLORS[0],
    field_manager_id: region?.field_manager_id || '',
    install_coordinator_id: region?.install_coordinator_id || '',
    order_entry_id: region?.order_entry_id || '',
    preferred_installer_crew_id: region?.preferred_installer_crew_id || '',
    preferred_installer_crew_name: region?.preferred_installer_crew_name || '',
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const safeCrews = Array.isArray(crews) ? crews : [];
  const memberOptions = Array.isArray(teamMembers) ? teamMembers.filter(m => m.is_active) : [];

  const handleCrewChange = (crewId) => {
    const crew = safeCrews.find(c => String(c.crewId || c.id) === crewId);
    set('preferred_installer_crew_id', crewId);
    set('preferred_installer_crew_name', crew?.crewName || crew?.name || crewId);
  };

  return (
    <div className="space-y-3 bg-muted rounded-xl p-3 text-sm">
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('rsRegionName')}</label>
        <Input
          value={form.region_name}
          onChange={e => set('region_name', e.target.value)}
          placeholder={t('rsRegionPlaceholder')}
          className="h-8 text-sm"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('rsColor')}</label>
        <div className="flex gap-1.5 flex-wrap">
          {REGION_COLORS.map(c => (
            <button
              key={c}
              onClick={() => set('color', c)}
              className="w-6 h-6 rounded-full border-2 transition-all"
              style={{
                backgroundColor: c,
                // The swatch fill is data (above); the selection ring is chrome, so it tokenises.
                borderColor: form.color === c ? 'hsl(var(--foreground))' : 'transparent',
                transform: form.color === c ? 'scale(1.2)' : 'scale(1)'
              }}
            />
          ))}
        </div>
      </div>

      {[
        { key: 'field_manager_id', label: t('rsFieldManager') },
        { key: 'install_coordinator_id', label: t('rsInstallCoordinator') },
        { key: 'order_entry_id', label: t('rsOrderEntry') },
      ].map(({ key, label }) => (
        <div key={key}>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
          <select
            value={form[key]}
            onChange={e => set(key, e.target.value)}
            className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          >
            <option value="">{t('rsSelect')}</option>
            {memberOptions.map(m => (
              <option key={m.id} value={m.id}>
                {m.first_name} {m.last_name}
              </option>
            ))}
          </select>
        </div>
      ))}

      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('rsPreferredInstaller')}</label>
        <select
          value={form.preferred_installer_crew_id}
          onChange={e => handleCrewChange(e.target.value)}
          className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
        >
          <option value="">{t('rsSelectCrew')}</option>
          {safeCrews.map(c => (
            <option key={c.crewId || c.id} value={String(c.crewId || c.id)}>
              {c.crewName || c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2 pt-1">
        <Button size="sm" className="flex-1 h-7 text-xs" onClick={() => onSave(form)}>
          <Check className="w-3 h-3 mr-1" /> {t('rsSave')}
        </Button>
        <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={onCancel}>
          <X className="w-3 h-3 mr-1" /> {t('rsCancel')}
        </Button>
      </div>
    </div>
  );
}

export default function RegionSidebar({
  regions = [], teamMembers = [], crews = [], onAddRegion, onEditRegion, onDeleteRegion,
  onStartDrawing, drawingRegion, journeyOrders = []
}) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState({});
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [pendingForm, setPendingForm] = useState(null);

  const toggle = (id) => setExpanded(e => ({ ...e, [id]: !e[id] }));

  const handleCreate = (form) => {
    onAddRegion(form);
    setCreating(false);
    setPendingForm(null);
  };

  const handleEdit = (id, form) => {
    onEditRegion(id, form);
    setEditingId(null);
  };

  const getOrderCount = (regionId) =>
    journeyOrders.filter(o => o.region_assignment_id === regionId).length;

  const getMemberName = (id) => {
    const m = teamMembers.find(m => m.id === id);
    return m ? `${m.first_name} ${m.last_name}` : '—';
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-foreground text-sm">{t('rsTitle')}</h2>
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={() => setCreating(true)}
          disabled={!!creating || !!drawingRegion}
        >
          <Plus className="w-3 h-3 mr-1" /> {t('rsNew')}
        </Button>
      </div>

      <div className="space-y-2 overflow-y-auto flex-1">
        {creating && (
          <RegionForm
            teamMembers={teamMembers}
            crews={crews}
            onSave={(form) => {
              setPendingForm(form);
              setCreating(false);
              onStartDrawing(form);
            }}
            onCancel={() => setCreating(false)}
          />
        )}

        {regions.map((region, idx) => (
          <div
            key={region.id}
            className="border border-border rounded-xl overflow-hidden bg-card"
          >
            <div className="flex items-center gap-2 px-3 py-2.5">
              {/* Region identity colour is data (see REGION_COLORS); the hex fallback
                  mirrors REGION_COLORS[0] and the default the map draws with. */}
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: region.color || '#4F46E5' }}
              />
              <span className="font-medium text-sm text-foreground flex-1 truncate">
                {region.region_name}
              </span>
              {/* A count chip, not a status — kept as a plain neutral chip rather than a
                  StatusPill, whose tones and uppercase treatment would imply state. */}
              <span className="text-xs text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                {t('rsJobsCount', { count: getOrderCount(region.id) })}
              </span>
              <button onClick={() => toggle(region.id)} className="p-0.5 text-muted-foreground hover:text-foreground">
                {expanded[region.id] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>

            {expanded[region.id] && (
              <div className="px-3 pb-3 space-y-2 border-t border-border pt-2">
                {editingId === region.id ? (
                  <RegionForm
                    region={region}
                    teamMembers={teamMembers}
                    crews={crews}
                    onSave={(form) => handleEdit(region.id, form)}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <div><span className="font-medium">{t('rsFieldManager')}:</span> {getMemberName(region.field_manager_id)}</div>
                      <div><span className="font-medium">{t('rsInstallCoordinator')}:</span> {getMemberName(region.install_coordinator_id)}</div>
                      <div><span className="font-medium">{t('rsOrderEntry')}:</span> {getMemberName(region.order_entry_id)}</div>
                      <div><span className="font-medium">{t('rsZips', { count: region.zip_codes?.length || 0 })}:</span>{' '}
                        {region.zip_codes?.length > 0
                          ? <span className="font-mono">{region.zip_codes.join(', ')}</span>
                          : <span className="text-muted-foreground/60">{t('rsNoZips')}</span>
                        }
                      </div>
                      {/* Inline warning, not a badge — the surrounding block is a stack of
                          key/value lines, so a StatusPill here would break that rhythm.
                          The warn token carries the same meaning. */}
                      {!region.polygon_coordinates?.length && (
                        <div className="text-warn font-medium">{t('rsNoPolygon')}</div>
                      )}
                    </div>
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 h-6 text-xs"
                        onClick={() => onStartDrawing(region)}
                      >
                        {region.polygon_coordinates?.length ? t('rsRedraw') : t('rsDrawPolygon')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 w-6 p-0"
                        onClick={() => setEditingId(region.id)}
                      >
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 w-6 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => onDeleteRegion(region.id)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}

        {regions.length === 0 && !creating && (
          <div className="text-center py-8 text-muted-foreground text-xs">
            {t('rsNoRegions')}<br />{t('rsNoRegionsHint')}
          </div>
        )}
      </div>
    </div>
  );
}