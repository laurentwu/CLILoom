// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Command, CommandItem, CommandList } from './command'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from './context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from './dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const originalScrollIntoView = Element.prototype.scrollIntoView

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn()
  })
})

afterEach(() => {
  cleanup()
})

afterAll(() => {
  vi.unstubAllGlobals()
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: originalScrollIntoView
  })
})

function getSlot(slot: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-slot="${slot}"]`)
  expect(element).not.toBeNull()
  return element!
}

describe('popup menu single-line layout', () => {
  it('sizes dropdown menus to their content while keeping every row on one line', () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Open menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Menu heading</DropdownMenuLabel>
          <DropdownMenuItem>Regular item</DropdownMenuItem>
          <DropdownMenuRadioGroup value="radio">
            <DropdownMenuRadioItem value="radio">Radio item</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSub open>
            <DropdownMenuSubTrigger>Nested menu</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Nested item</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    const content = getSlot('dropdown-menu-content')
    expect(content.classList).toContain('w-max')
    expect(content.className).toContain(
      'max-w-[min(24rem,var(--radix-dropdown-menu-content-available-width))]'
    )
    expect(getSlot('dropdown-menu-label').classList).toContain('truncate')
    expect(getSlot('dropdown-menu-item').classList).toContain('whitespace-nowrap')
    expect(getSlot('dropdown-menu-radio-item').classList).toContain('whitespace-nowrap')
    expect(getSlot('dropdown-menu-sub-trigger').classList).toContain('whitespace-nowrap')

    const subContent = getSlot('dropdown-menu-sub-content')
    expect(subContent.classList).toContain('w-max')
    expect(subContent.className).toContain(
      'max-w-[min(24rem,var(--radix-dropdown-menu-content-available-width))]'
    )
  })

  it('keeps context menu rows on one line and bounds the content width', () => {
    const { getByText } = render(
      <ContextMenu>
        <ContextMenuTrigger>Open context menu</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Context action</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )

    fireEvent.contextMenu(getByText('Open context menu'), { clientX: 20, clientY: 20 })

    const content = getSlot('context-menu-content')
    expect(content.classList).toContain('w-max')
    expect(content.className).toContain(
      'max-w-[min(24rem,var(--radix-context-menu-content-available-width))]'
    )
    expect(getSlot('context-menu-item').classList).toContain('whitespace-nowrap')
  })

  it('truncates select item text without allowing the row to wrap', () => {
    render(
      <Select open value="one">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="one">A very long option</SelectItem>
        </SelectContent>
      </Select>
    )

    const content = getSlot('select-content')
    expect(content.classList).toContain('w-max')
    expect(content.classList).toContain('max-w-[min(24rem,calc(100vw-2rem))]')
    expect(content.className).not.toContain('--radix-select-content-available-width')

    const item = getSlot('select-item')
    const itemText = item.querySelector<HTMLElement>('[data-slot="select-item-text"]')
    expect(item.classList).toContain('whitespace-nowrap')
    expect(itemText).not.toBeNull()
    expect(itemText?.classList).toContain('truncate')
    expect(itemText?.querySelector('[id]')?.textContent).toBe('A very long option')
    expect(getSlot('select-value').textContent).toBe('A very long option')
  })

  it('keeps command palette options on one line', () => {
    render(
      <Command>
        <CommandList>
          <CommandItem value="command">Command option</CommandItem>
        </CommandList>
      </Command>
    )

    expect(getSlot('command-item').classList).toContain('whitespace-nowrap')
  })
})
