// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_ASSISTANT_CONFIG,
  DEFAULT_LAYOUT_PREFERENCES,
  DEFAULT_SHELL_PREFERENCES
} from '../../shared/appSettings'
import { DEFAULT_SKIN } from '../theme'
import type { ShellSnapshot } from '../../shared/shell'

vi.mock('../components/XtermTerminal', () => ({
  XtermTerminal: () => null
}))

vi.mock('@/components/ui/tooltip', async () => {
  const React = await import('react')
  const Passthrough = ({ children }: { children?: React.ReactNode }) => React.createElement(
    React.Fragment,
    null,
    children
  )
  return {
    Tooltip: Passthrough,
    TooltipContent: () => null,
    TooltipTrigger: Passthrough
  }
})

import { AssistantApp } from './AssistantApp'

describe('AssistantApp global shell state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('blocks startup for an unavailable shell and reacts to global shell updates', () => {
    let shellsChanged: ((snapshot: ShellSnapshot) => void) | undefined
    const unsubscribe = () => undefined
    Object.defineProperty(window, 'cliLoomAssistant', {
      configurable: true,
      value: {
        onTerminalStatus: vi.fn(() => unsubscribe),
        onTerminalData: vi.fn(() => unsubscribe),
        onSettingsChanged: vi.fn(() => unsubscribe),
        onThemeFallback: vi.fn(() => unsubscribe),
        onShellsChanged: vi.fn((callback: (snapshot: ShellSnapshot) => void) => {
          shellsChanged = callback
          return unsubscribe
        }),
        hide: vi.fn(),
        close: vi.fn(),
        write: vi.fn(),
        resize: vi.fn()
      },
      writable: true
    })
    const unavailable: ShellSnapshot = {
      platform: 'linux',
      preferences: DEFAULT_SHELL_PREFERENCES,
      candidates: [],
      effectiveShell: null,
      error: '所选 Shell 不可用：bash (/missing/bash)'
    }
    render(<AssistantApp
      bootstrapError={null}
      initialBootstrap={{
        settings: {
          assistant: DEFAULT_ASSISTANT_CONFIG,
          appearance: DEFAULT_APPEARANCE_PREFERENCES,
          layout: DEFAULT_LAYOUT_PREFERENCES,
          shell: DEFAULT_SHELL_PREFERENCES,
          skins: [],
          activeSkin: DEFAULT_SKIN
        },
        shell: unavailable,
        status: { state: 'idle' },
        transcript: ''
      }}
    />)

    fireEvent.change(screen.getByLabelText('Initialization command'), { target: { value: 'codex' } })
    const startButton = screen.getByRole('button', { name: 'Save and start' }) as HTMLButtonElement

    expect(startButton.disabled).toBe(true)
    expect(screen.getByText('Global terminal environment unavailable')).toBeTruthy()
    expect(screen.getByText(/Return to the main window settings to redetect or choose another terminal environment/)).toBeTruthy()

    const bash = {
      id: 'posix:%2Fbin%2Fbash',
      displayName: 'bash',
      family: 'posix' as const,
      executablePath: '/bin/bash',
      source: 'system' as const
    }
    act(() => shellsChanged?.({
      platform: 'linux',
      preferences: DEFAULT_SHELL_PREFERENCES,
      candidates: [bash],
      effectiveShell: bash
    }))

    expect(startButton.disabled).toBe(false)
    expect(screen.getByText('bash')).toBeTruthy()
    expect(screen.getByText('/bin/bash')).toBeTruthy()
    expect(screen.getByText(/changes take effect the next time the assistant starts or restarts/)).toBeTruthy()
  })

  it('explains why a configured exited assistant cannot restart after its shell disappears', () => {
    let shellsChanged: ((snapshot: ShellSnapshot) => void) | undefined
    const unsubscribe = () => undefined
    Object.defineProperty(window, 'cliLoomAssistant', {
      configurable: true,
      value: {
        onTerminalStatus: vi.fn(() => unsubscribe),
        onTerminalData: vi.fn(() => unsubscribe),
        onSettingsChanged: vi.fn(() => unsubscribe),
        onThemeFallback: vi.fn(() => unsubscribe),
        onShellsChanged: vi.fn((callback: (snapshot: ShellSnapshot) => void) => {
          shellsChanged = callback
          return unsubscribe
        }),
        restart: vi.fn(),
        hide: vi.fn(),
        close: vi.fn(),
        write: vi.fn(),
        resize: vi.fn()
      },
      writable: true
    })
    const bash = {
      id: 'posix:%2Fbin%2Fbash',
      displayName: 'bash',
      family: 'posix' as const,
      executablePath: '/bin/bash',
      source: 'system' as const
    }
    render(<AssistantApp
      bootstrapError={null}
      initialBootstrap={{
        settings: {
          assistant: { version: 1, initializationCommand: 'codex' },
          appearance: DEFAULT_APPEARANCE_PREFERENCES,
          layout: DEFAULT_LAYOUT_PREFERENCES,
          shell: DEFAULT_SHELL_PREFERENCES,
          skins: [],
          activeSkin: DEFAULT_SKIN
        },
        shell: {
          platform: 'linux',
          preferences: DEFAULT_SHELL_PREFERENCES,
          candidates: [bash],
          effectiveShell: bash
        },
        status: { state: 'exited', exitCode: 0 },
        transcript: ''
      }}
    />)

    const restartButton = screen.getByRole('button', { name: 'Restart' }) as HTMLButtonElement
    expect(restartButton.disabled).toBe(false)

    act(() => shellsChanged?.({
      platform: 'linux',
      preferences: DEFAULT_SHELL_PREFERENCES,
      candidates: [],
      effectiveShell: null,
      error: '所选 Shell 不可用：bash (/missing/bash)'
    }))

    expect(restartButton.disabled).toBe(true)
    expect(screen.getByText(/所选 Shell 不可用.*Return to the main window settings/)).toBeTruthy()
  })
})
