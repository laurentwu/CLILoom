import { describe, it, expect } from 'vitest'
import en from './locales/en'
import zh from './locales/zh'
import { createI18n } from './index'
import { SKIN_COLOR_TOKEN_KEYS } from '../skin'

type Leaf = Record<string, unknown> | string

function collectKeys(value: Leaf, prefix = ''): string[] {
  if (typeof value === 'string') return prefix ? [prefix] : []
  const keys: string[] = []
  for (const [key, child] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key
    keys.push(...collectKeys(child as Leaf, next))
  }
  return keys.sort()
}

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g

function collectPlaceholders(value: Leaf, prefix = ''): Array<{ key: string; placeholders: string[] }> {
  if (typeof value === 'string') {
    const placeholders = (value.match(PLACEHOLDER_RE) ?? []).map((match) => match.slice(2, -2)).sort()
    return prefix ? [{ key: prefix, placeholders }] : []
  }
  const entries: Array<{ key: string; placeholders: string[] }> = []
  for (const [key, child] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key
    entries.push(...collectPlaceholders(child as Leaf, next))
  }
  return entries
}

describe('i18n catalogs', () => {
  it('en and zh share the same recursive key set', () => {
    expect(collectKeys(zh)).toEqual(collectKeys(en))
  })

  it('en and zh share the same interpolation placeholders per leaf key', () => {
    const enPlaceholders = collectPlaceholders(en)
    const zhPlaceholders = collectPlaceholders(zh)
    expect(zhPlaceholders).toEqual(enPlaceholders)
  })
})

describe('createI18n', () => {
  it('translates a fully-qualified key', () => {
    const i18n = createI18n('en')
    expect(i18n.t('common:action.cancel')).toBe('Cancel')
  })

  it('interpolates parameters', () => {
    const i18n = createI18n('en')
    expect(i18n.t('errors:exit.unsafeMessage', { detail: 'boom' })).toContain('boom')
  })

  it('switches catalog on changeLanguage', () => {
    const i18n = createI18n('en')
    expect(i18n.t('common:action.cancel')).toBe('Cancel')
    i18n.changeLanguage('zh')
    expect(i18n.t('common:action.cancel')).toBe('取消')
  })

  it('localizes the assistant initialization command placeholder', () => {
    const i18n = createI18n('en')
    expect(i18n.t('assistant:command.placeholder')).toBe(
      'Enter the AI CLI launch command you normally use, such as codex or opencode'
    )
    i18n.changeLanguage('zh')
    expect(i18n.t('assistant:command.placeholder')).toBe(
      '输入常用的 AI CLI 启动命令，如 codex 或 opencode'
    )
  })

  it('uses precise labels for workflow completion, assistant exit and theme actions', () => {
    const i18n = createI18n('zh')
    expect(i18n.t('node:end.completedDescription')).toBe('工作流已到达结束节点。')
    expect(i18n.t('assistant:status.ended', { code: 0 })).toBe('已结束（退出码：0）')
    expect(i18n.t('node:parallel.routesCount', { count: 2 })).toBe('2 条并行路线')
    expect(i18n.t('skin:action.apply')).toBe('应用主题')
    expect(i18n.t('skin:action.confirm')).toBe('保存')
  })

  it('names theme colors by their interface location and state', () => {
    const i18n = createI18n('en')
    expect(i18n.t('skin:token.background')).toBe('Page base background')
    expect(i18n.t('skin:token.accent')).toBe('Hover or selected-item background')
    expect(i18n.t('skin:tokenDescription.mutedForeground')).toContain('descriptions')

    i18n.changeLanguage('zh')
    expect(i18n.t('skin:token.background')).toBe('页面基础背景色')
    expect(i18n.t('skin:section.navigation')).toBe('左侧导航栏')
    expect(i18n.t('skin:background.description')).toContain('页面基础背景色')
  })

  it('provides labels and descriptions for every editable theme color in both languages', () => {
    const i18n = createI18n('en')

    for (const language of ['en', 'zh'] as const) {
      i18n.changeLanguage(language)
      for (const key of SKIN_COLOR_TOKEN_KEYS) {
        const label = i18n.t(`skin:token.${key}`)
        const description = i18n.t(`skin:tokenDescription.${key}`)
        expect(label, `${language} label for ${key}`).toBeTypeOf('string')
        expect(label, `${language} label for ${key}`).not.toBe('')
        expect(label, `${language} label for ${key}`).not.toMatch(/^skin:/)
        expect(description, `${language} description for ${key}`).toBeTypeOf('string')
        expect(description, `${language} description for ${key}`).not.toBe('')
        expect(description, `${language} description for ${key}`).not.toMatch(/^skin:/)
      }
    }
  })
})
