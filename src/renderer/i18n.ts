import { createI18n } from '../shared/i18n'
import en from '../shared/i18n/locales/en'
import { resolveLanguageFromLocale, type SupportedLanguage } from '../shared/appSettings'

function detectInitialLanguage(): SupportedLanguage {
  const locale = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en'
  return resolveLanguageFromLocale(locale)
}

export const i18n = createI18n(detectInitialLanguage())

export function syncI18nLanguage(language: SupportedLanguage): void {
  if (i18n.language !== language) i18n.changeLanguage(language)
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = language
  }
}

declare module 'react-i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: typeof en
    allowObjectInHTMLChildren: true
  }
}
