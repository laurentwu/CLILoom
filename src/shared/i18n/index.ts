import i18next, { type i18n as I18nInstance } from 'i18next'
import type { SupportedLanguage } from '../appSettings'
import en from './locales/en'
import zh from './locales/zh'

export const I18N_FALLBACK_LNG: SupportedLanguage = 'en'
export const I18N_DEFAULT_NAMESPACE = 'common'
export const I18N_NAMESPACES = [
  'common',
  'project',
  'task',
  'workflow',
  'designer',
  'terminal',
  'status',
  'settings',
  'errors',
  'assistant',
  'skin'
] as const

export const I18N_RESOURCES = {
  en,
  zh
}

export function createI18n(lng: SupportedLanguage): I18nInstance {
  const instance = i18next.createInstance()
  instance.init({
    lng,
    fallbackLng: I18N_FALLBACK_LNG,
    resources: I18N_RESOURCES,
    defaultNS: I18N_DEFAULT_NAMESPACE,
    ns: [...I18N_NAMESPACES],
    interpolation: { escapeValue: false },
    returnEmptyString: false,
    react: { useSuspense: false }
  })
  return instance
}
