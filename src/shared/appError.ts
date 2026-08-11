import type { TranslationKey } from './i18n/types'

export type AppErrorOptions = {
  code: string
  message: string
  i18nKey?: TranslationKey
  params?: Record<string, unknown>
  cause?: unknown
}

export class AppError extends Error {
  readonly code: string
  readonly i18nKey?: TranslationKey
  readonly params?: Record<string, unknown>

  constructor(opts: AppErrorOptions) {
    super(opts.message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = new.target.name
    this.code = opts.code
    this.i18nKey = opts.i18nKey
    this.params = opts.params
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError
}
