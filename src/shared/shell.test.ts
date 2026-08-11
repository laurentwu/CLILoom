import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SHELL_PREFERENCES,
  createWslTargetId,
  parseShellNeutralCommand,
  parseShellPreferences
} from './shell'

describe('shell settings contract', () => {
  it('defaults old or malformed settings to automatic selection', () => {
    expect(parseShellPreferences(undefined)).toEqual(DEFAULT_SHELL_PREFERENCES)
    expect(parseShellPreferences({ version: 99, selection: { mode: 'automatic' } }))
      .toEqual(DEFAULT_SHELL_PREFERENCES)
    expect(parseShellPreferences({
      version: 1,
      selection: {
        mode: 'explicit',
        shell: {
          id: 'bad',
          displayName: 'Bad',
          family: 'fish',
          executablePath: '/tmp/fish'
        }
      }
    })).toEqual(DEFAULT_SHELL_PREFERENCES)
  })

  it('preserves a valid explicit descriptor for unavailable-shell diagnostics', () => {
    const preferences = parseShellPreferences({
      version: 1,
      selection: {
        mode: 'explicit',
        shell: {
          id: 'powershell:C%3A%5CTools%5Cpwsh.exe',
          displayName: 'PowerShell 7',
          family: 'powershell',
          executablePath: 'C:\\Tools\\pwsh.exe'
        }
      }
    })

    expect(preferences).toMatchObject({
      version: 2,
      selection: {
        mode: 'explicit',
        shell: {
          kind: 'native',
          displayName: 'PowerShell 7',
          executablePath: 'C:\\Tools\\pwsh.exe'
        }
      }
    })
  })

  it('persists a concrete WSL identity and rejects malformed descriptors', () => {
    const distributionName = 'Ubuntu Dev 中文'
    const id = createWslTargetId(distributionName)
    expect(id).toBe('wsl:v1:Ubuntu%20Dev%20%E4%B8%AD%E6%96%87')
    expect(parseShellPreferences({
      version: 2,
      selection: {
        mode: 'explicit',
        shell: {
          kind: 'wsl',
          id,
          displayName: distributionName,
          family: 'posix',
          distributionName
        }
      }
    })).toEqual({
      version: 2,
      selection: {
        mode: 'explicit',
        shell: {
          kind: 'wsl',
          id,
          displayName: distributionName,
          family: 'posix',
          distributionName
        }
      }
    })
    expect(parseShellPreferences({
      version: 2,
      selection: {
        mode: 'explicit',
        shell: {
          kind: 'wsl',
          id,
          displayName: distributionName,
          family: 'posix',
          distributionName: 'bad\nname'
        }
      }
    })).toEqual(DEFAULT_SHELL_PREFERENCES)
    expect(parseShellPreferences({
      version: 2,
      selection: {
        mode: 'explicit',
        shell: {
          kind: 'wsl',
          id: createWslTargetId('Ubuntu'),
          displayName: distributionName,
          family: 'posix',
          distributionName
        }
      }
    })).toEqual(DEFAULT_SHELL_PREFERENCES)
    expect(() => parseShellPreferences({
      version: 2,
      selection: {
        mode: 'explicit',
        shell: {
          kind: 'wsl',
          id: 'wsl:v1:malformed',
          displayName: 'Malformed',
          family: 'posix',
          distributionName: '\ud800'
        }
      }
    })).not.toThrow()
    expect(parseShellPreferences({
      version: 2,
      selection: {
        mode: 'explicit',
        shell: {
          kind: 'wsl',
          id: 'wsl:v1:malformed',
          displayName: 'Malformed',
          family: 'posix',
          distributionName: '\ud800'
        }
      }
    })).toEqual(DEFAULT_SHELL_PREFERENCES)
  })
})

describe('shell-neutral command contract', () => {
  it('accepts referenced bindings and rejects malformed or NUL-bearing values', () => {
    expect(parseShellNeutralCommand({
      version: 1,
      segments: [
        { type: 'literal', value: 'echo ' },
        { type: 'binding', name: 'CLILOOM_INTERNAL_VALUE_0' }
      ],
      bindings: { CLILOOM_INTERNAL_VALUE_0: '中文 😀' }
    })).not.toBeNull()
    expect(parseShellNeutralCommand({
      version: 1,
      segments: [{ type: 'binding', name: 'CLILOOM_INTERNAL_VALUE_1' }],
      bindings: { CLILOOM_INTERNAL_VALUE_0: 'value' }
    })).toBeNull()
    expect(parseShellNeutralCommand({
      version: 1,
      segments: [{ type: 'literal', value: 'echo' }],
      bindings: { CLILOOM_INTERNAL_VALUE_0: 'bad\0value' }
    })).toBeNull()
  })
})
