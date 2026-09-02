import React, { useEffect, useRef, useState } from 'react';
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

// The owner's own HTTP-referrer-restricted Google Places/Maps-JS key, set in Vercel env.
// When it's absent the field degrades to a plain manual-entry text input (no script loaded).
const GOOGLE_PLACES_API_KEY = import.meta.env.VITE_GOOGLE_PLACES_API_KEY;

export function AddressAutocomplete({ 
  value, 
  onChange, 
  onPlaceSelected,
  placeholder = "Start typing an address...",
  className,
  ...props 
}) {
  const inputRef = useRef(null);
  const autocompleteRef = useRef(null);
  const listenerRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [internalValue, setInternalValue] = useState(value || '');

  useEffect(() => {
    // No key configured -> degrade to a plain manual-entry text input (never stuck disabled).
    if (!GOOGLE_PLACES_API_KEY) {
      setScriptLoaded(false);
      setIsLoading(false);
      return;
    }
    // Check if script is already loaded
    if (window.google?.maps?.places) {
      setScriptLoaded(true);
      setIsLoading(false);
      return;
    }

    // Load Google Places script
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_PLACES_API_KEY}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      setScriptLoaded(true);
      setIsLoading(false);
    };
    // If the script fails to load (bad/blocked key), fall back to manual entry rather than
    // leaving the input disabled forever.
    script.onerror = () => {
      setScriptLoaded(false);
      setIsLoading(false);
    };
    document.head.appendChild(script);

    return () => {
      // Cleanup if needed
    };
  }, []);

  // Sync internal value with external value
  useEffect(() => {
    setInternalValue(value || '');
  }, [value]);

  useEffect(() => {
    if (!scriptLoaded || !inputRef.current) return;

    // Clean up previous instance if exists
    if (listenerRef.current) {
      window.google.maps.event.removeListener(listenerRef.current);
      listenerRef.current = null;
    }

    // Initialize autocomplete
    autocompleteRef.current = new window.google.maps.places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: 'us' },
      fields: ['address_components', 'formatted_address', 'geometry'],
      types: ['address']
    });

    // Style the autocomplete dropdown with very high z-index for dialogs
    if (!document.getElementById('pac-autocomplete-styles')) {
      const style = document.createElement('style');
      style.id = 'pac-autocomplete-styles';
      style.innerHTML = `
        .pac-container {
          z-index: 99999 !important;
          border-radius: 8px;
          box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
          border: 1px solid #e2e8f0;
          font-family: inherit;
          pointer-events: auto !important;
        }
        .pac-item {
          padding: 8px 12px;
          cursor: pointer;
          border: none;
          pointer-events: auto !important;
        }
        .pac-item:hover {
          background-color: #f8fafc;
        }
        .pac-item-query {
          font-size: 14px;
          color: #1e293b;
        }
      `;
      document.head.appendChild(style);
    }

    // Listen for place selection
    listenerRef.current = autocompleteRef.current.addListener('place_changed', () => {
      const place = autocompleteRef.current.getPlace();
      
      if (!place || !place.address_components) {
        return;
      }

      // Parse address components
      const addressData = {
        address_line1: '',
        address_line2: '',
        city: '',
        state: '',
        zip: '',
        formatted_address: place.formatted_address || ''
      };

      let streetNumber = '';
      let route = '';

      place.address_components.forEach(component => {
        const types = component.types;
        
        if (types.includes('street_number')) {
          streetNumber = component.long_name;
        }
        if (types.includes('route')) {
          route = component.long_name;
        }
        if (types.includes('locality')) {
          addressData.city = component.long_name;
        }
        // Fallback to sublocality if locality is not present
        if (!addressData.city && types.includes('sublocality')) {
          addressData.city = component.long_name;
        }
        // Fallback to postal_town if still no city
        if (!addressData.city && types.includes('postal_town')) {
          addressData.city = component.long_name;
        }
        if (types.includes('administrative_area_level_1')) {
          addressData.state = component.short_name;
        }
        if (types.includes('postal_code')) {
          addressData.zip = component.long_name;
        }
      });

      addressData.address_line1 = `${streetNumber} ${route}`.trim();

      // Wait a tick to override Google's auto-fill
      requestAnimationFrame(() => {
        setInternalValue(addressData.address_line1);
        
        if (inputRef.current) {
          inputRef.current.value = addressData.address_line1;
        }

        // Call onPlaceSelected with parsed data
        if (onPlaceSelected) {
          onPlaceSelected(addressData);
        }
      });
    });

    return () => {
      if (listenerRef.current) {
        window.google.maps.event.removeListener(listenerRef.current);
        listenerRef.current = null;
      }
    };
  }, [scriptLoaded, onPlaceSelected]);

  const handleInputChange = (e) => {
    const newValue = e.target.value;
    setInternalValue(newValue);
    if (onChange) {
      onChange(newValue);
    }
  };

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        value={internalValue}
        onChange={handleInputChange}
        placeholder={placeholder}
        className={className}
        disabled={isLoading}
        autoComplete="new-password"
        {...props}
      />
      {isLoading && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}