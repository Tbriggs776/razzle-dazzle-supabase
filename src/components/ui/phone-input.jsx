import React from 'react';
import { Input } from '@/components/ui/input';

export function PhoneInput({ value, onChange, ...props }) {
  const formatPhoneNumber = (input) => {
    // Remove all non-digits
    const digits = input.replace(/\D/g, '');
    
    // Limit to 10 digits
    const limited = digits.slice(0, 10);
    
    // Format as (XXX) XXX-XXXX
    if (limited.length <= 3) {
      return limited;
    } else if (limited.length <= 6) {
      return `(${limited.slice(0, 3)}) ${limited.slice(3)}`;
    } else {
      return `(${limited.slice(0, 3)}) ${limited.slice(3, 6)}-${limited.slice(6)}`;
    }
  };

  const handleChange = (e) => {
    const formatted = formatPhoneNumber(e.target.value);
    onChange({ target: { value: formatted } });
  };

  return (
    <Input
      {...props}
      type="tel"
      value={value || ''}
      onChange={handleChange}
      placeholder="(555) 123-4567"
    />
  );
}