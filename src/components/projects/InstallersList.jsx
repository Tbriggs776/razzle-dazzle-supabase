import React from 'react';
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X } from 'lucide-react';

const MAX_INSTALLERS = 5;

export default function InstallersList({ installers, onChange, crews, crewsLoading }) {
  const addInstaller = () => {
    if (installers.length >= MAX_INSTALLERS) return;
    onChange([...installers, { mode: 'dropdown', value: '' }]);
  };

  const removeInstaller = (index) => {
    onChange(installers.filter((_, i) => i !== index));
  };

  const updateInstaller = (index, value) => {
    const updated = [...installers];
    updated[index] = { ...updated[index], value };
    onChange(updated);
  };

  const toggleMode = (index) => {
    const updated = [...installers];
    updated[index] = { mode: updated[index].mode === 'dropdown' ? 'text' : 'dropdown', value: '' };
    onChange(updated);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <Label>Installer(s)</Label>
        {installers.length < MAX_INSTALLERS && (
          <button type="button" onClick={addInstaller} className="text-xs text-indigo-600 hover:underline flex items-center gap-1">
            <Plus className="w-3 h-3" /> Add Installer
          </button>
        )}
      </div>
      <div className="space-y-2">
        {installers.map((installer, index) => (
          <div key={index} className="flex items-center gap-2">
            {installer.mode === 'dropdown' ? (
              <Select
                value={installer.value}
                onValueChange={v => {
                  if (v === '__other__') toggleMode(index);
                  else updateInstaller(index, v);
                }}
                disabled={crewsLoading}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder={crewsLoading ? 'Loading crews...' : 'Select installer...'} />
                </SelectTrigger>
                <SelectContent>
                  {crews.map(crew => (
                    <SelectItem key={crew.crewId ?? crew.id ?? crew.name} value={crew.name ?? crew.crewName ?? String(crew.crewId)}>
                      {crew.name ?? crew.crewName ?? `Crew ${crew.crewId}`}
                    </SelectItem>
                  ))}
                  <SelectItem value="__other__">Other (type manually)</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div className="flex gap-2 flex-1">
                <Input
                  value={installer.value}
                  onChange={e => updateInstaller(index, e.target.value)}
                  placeholder="Enter installer name..."
                  className="flex-1"
                  autoFocus={index === installers.length - 1}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => toggleMode(index)}>
                  ← List
                </Button>
              </div>
            )}
            {installers.length > 1 && (
              <button type="button" onClick={() => removeInstaller(index)} className="text-slate-400 hover:text-red-500 transition-colors">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>
      {installers.length >= MAX_INSTALLERS && (
        <p className="text-xs text-slate-400 mt-1">Maximum of {MAX_INSTALLERS} installers reached.</p>
      )}
    </div>
  );
}