import type en from './locales/en'

export type AppCatalog = typeof en

export type AppNamespace = keyof AppCatalog

type Flatten<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? Prefix extends ''
      ? K
      : `${Prefix}.${K}`
    : T[K] extends Readonly<Record<string, unknown>>
      ? Flatten<T[K], Prefix extends '' ? K : `${Prefix}.${K}`>
      : never
}[keyof T & string]

export type NamespaceKey<N extends AppNamespace> = Flatten<AppCatalog[N], ''>

export type TranslationKey = {
  [N in AppNamespace]: `${N}:${NamespaceKey<N>}`
}[AppNamespace]
