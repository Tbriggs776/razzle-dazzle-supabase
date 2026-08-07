import React, { createContext, useContext, useState, useCallback } from 'react';
import { journeyTranslations } from './translations';

const LanguageContext = createContext();

const STORAGE_KEY = 'razzle_language';

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) || 'en';
  });

  const changeLanguage = useCallback((lang) => {
    setLanguage(lang);
    localStorage.setItem(STORAGE_KEY, lang);
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