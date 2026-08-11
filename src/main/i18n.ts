import { createI18n } from '../shared/i18n'
import type { TranslationKey } from '../shared/i18n/types'
import type { SupportedLanguage } from '../shared/appSettings'

let instance = createI18n('en')

export function initMainI18n(language: SupportedLanguage): void {
  instance = createI18n(language)
}

export function setMainI18nLanguage(language: SupportedLanguage): void {
  if (instance.language !== language) instance.changeLanguage(language)
}

export function t(key: TranslationKey, params?: Record<string, unknown>): string {
  return instance.t(key, params)
}

export function getMainI18nLanguage(): string {
  return instance.language
}
