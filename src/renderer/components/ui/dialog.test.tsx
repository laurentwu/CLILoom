// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Dialog, DialogContent } from './dialog'

afterEach(() => {
  cleanup()
})

describe('DialogContent width merge', () => {
  it('lets a responsive sm:max-width override the builtin sm:max-w-sm', () => {
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
})
