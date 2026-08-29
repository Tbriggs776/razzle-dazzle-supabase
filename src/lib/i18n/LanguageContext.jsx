import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { journeyTranslations } from './translations';
import { base44 } from '@/api/base44Client';

const LanguageContext = createContext();

const STORAGE_KEY = 'razzle_language';

/**
 * The language choice follows the PERSON, not the device.
 *
 * It used to live only in localStorage, so a Spanish-speaking installer who set it
 * on the yard phone got English again on his own phone, English again after
 * clearing site data, and English on the first device he ever opens a job on —
 * which is the one that matters, because that is where the assignment SMS lands.
 * No manager could set it for him either, because there was nowhere to set it.
 *
 * localStorage is still read FIRST and synchronously, deliberately: it means the
 * app paints in the right language immediately instead of flashing English while a
 * request is in flight. The stored preference then arrives and corrects it if they
 * differ. Every write goes to both, so the device stays a fast cache of the
 * server's answer.
 *
 * A failed lookup is silent on purpose. Not knowing someone's language preference
 * must never stop the app loading — they simply get what the device remembered,
 * which is what they had before this existed.
 */
export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || 'en'; } catch { return 'en'; }
  });

  // Pull the stored preference once at mount and reconcile.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await base44.functions.invoke('myPreferredLanguage', {});
        if (cancelled || error) return;
        const stored = typeof data === 'string' ? data : data?.language;
        if (stored && stored !== language) {
          setLanguage(stored);
          try { localStorage.setItem(STORAGE_KEY, stored); } catch { /* private mode */ }
        }
      } catch { /* never block the app on a preference */ }
    })();
    return () => { cancelled = true; };
    // Mount only: this reconciles the signed-in user's stored choice once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeLanguage = useCallback((lang) => {
    setLanguage(lang);
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* private mode */ }
    // Fire-and-forget: the UI has already switched. If this fails the choice still
    // holds on this device, which is exactly the old behaviour.
    base44.functions.invoke('setPreferredLanguage', { language: lang })
      .catch(() => { /* the device copy is enough */ });
  }, []);

  const t = useCallback((key, params) => {
    const dict = journeyTranslations[language] || journeyTranslations.en;
    let value;
    if (params && typeof params.count === 'number') {
      const pluralKey = `${key}_${params.count === 1 ? 'one' : 'other'}`;
      value = dict[pluralKey] ?? journeyTranslations.en[pluralKey] ?? dict[key] ?? journeyTranslations.en[key] ?? key;
    } else {
      value = dict[key] ?? journeyTranslations.en[key] ?? key;
    }
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        value = value.replace(new RegExp(`{{${k}}}`, 'g'), v);
      });
    }
    return value;
  }, [language]);

  return (
    <LanguageContext.Provider value={{ language, changeLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
