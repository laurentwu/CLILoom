import type { TranslationKey } from './types'

export type Translator = (key: TranslationKey, params?: Record<string, unknown>) => string

export type TranslationIssue = {
  key: TranslationKey
  params?: Record<string, unknown>
}
