import React, { useState, useEffect } from 'react';

export default function ImageDescriptionInput({ initialValue, onSave }) {
  const [value, setValue] = useState(initialValue || '');

  useEffect(() => {
    if (initialValue) {
      setValue(initialValue);
    }
  }, [initialValue]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(value);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-2 bg-white flex items-center gap-1">
      <input
        type="text"
        placeholder="Add a description..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            handleSave();
            e.target.blur();
          }
        }}
        className="flex-1 text-xs text-slate-600 bg-transparent border-0 border-b border-slate-200 focus:border-indigo-400 focus:outline-none pb-1 placeholder:text-slate-300"
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="text-xs text-indigo-500 hover:text-indigo-700 px-1 pb-1 flex-shrink-0 font-medium disabled:opacity-50"
      >
        {saving ? '...' : saved ? '✓' : 'Save'}
      </button>
    </div>
  );
}