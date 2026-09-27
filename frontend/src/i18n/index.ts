import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './en.json';
import zh from './zh.json';

export const LANGUAGES = ['en', 'zh'] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = 'sde.lang';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    fallbackLng: 'en',
    supportedLngs: LANGUAGES,
    // §8.7 — the choice is persisted; detection order puts storage first.
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false },
  });

// Keep <html lang> in sync so screen readers and the CJK font stack follow the choice.
function syncDocumentLang(lng: string) {
  document.documentElement.lang = lng === 'zh' ? 'zh-CN' : lng;
}
syncDocumentLang(i18n.resolvedLanguage ?? 'en');
i18n.on('languageChanged', syncDocumentLang);

export default i18n;
