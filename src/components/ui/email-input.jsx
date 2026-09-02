import React, { useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function EmailInput({ value = [], onChange, placeholder = "Type email and press Enter..." }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const email = input.trim();
      
      if (!email) {
        setError('Email cannot be empty');
        return;
      }

      if (!validateEmail(email)) {
        setError('Please enter a valid email address');
        return;
      }

      if (value.includes(email)) {
        setError('Email already added');
        return;
      }

      onChange([...value, email]);
      setInput('');
      setError('');
    }
  };

  const removeEmail = (emailToRemove) => {
    onChange(value.filter(email => email !== emailToRemove));
    setError('');
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);
    setError('');
  };

  return (
    <div className="w-full space-y-2">
      <div className="border border-border rounded-lg p-3 flex flex-wrap gap-2 items-start bg-white focus-within:ring-2 focus-within:ring-info focus-within:border-transparent transition-all">
        {value.map((email) => (
          <div
            key={email}
            className="flex items-center gap-2 bg-info/12 text-info px-3 py-1.5 rounded-lg text-sm font-medium border border-info/25"
          >
            <span>{email}</span>
            <button
              type="button"
              onClick={() => removeEmail(email)}
              className="hover:bg-info/12 rounded p-0.5 transition-colors"
              aria-label={`Remove ${email}`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <input
          type="text"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 min-w-32 outline-none bg-transparent text-sm font-mono"
        />
      </div>
      {error && <p className="text-xs text-crit">{error}</p>}
    </div>
  );
}