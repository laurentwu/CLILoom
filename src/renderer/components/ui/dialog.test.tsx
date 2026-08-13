// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { i18n } from '../../i18n'
import { Dialog, DialogContent } from './dialog'

afterEach(() => {
  cleanup()
  i18n.changeLanguage('en')
})

describe('DialogContent width merge', () => {
  it('lets a responsive sm:max-width override the builtin sm:max-w-sm', () => {
    i18n.changeLanguage('en')
    render(
      <Dialog open>
        <DialogContent className="sm:max-w-[min(80rem,calc(100%-2rem))]" />
      </Dialog>
    )
    const content = document.querySelector('[data-slot="dialog-content"]')
    expect(content).not.toBeNull()
    const cls = content?.getAttribute('class') ?? ''
    expect(cls).toContain('sm:max-w-[min(80rem,calc(100%-2rem))]')
    expect(cls).not.toContain('sm:max-w-sm')
  })

  it('localizes the built-in close button', () => {
    i18n.changeLanguage('zh')
    render(
      <Dialog open>
        <DialogContent />
      </Dialog>
    )

    expect(screen.getByRole('button', { name: '关闭' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })
})
