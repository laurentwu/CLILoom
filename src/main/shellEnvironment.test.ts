import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  parseUserShellPath,
  readUserShellPath,
  rebuildRuntimeShellEnvironment,
  withUserShellPath
} from './shellEnvironment'

describe('shell environment', () => {
  it('extracts PATH while ignoring shell startup output', () => {
    expect(parseUserShellPath([
      'startup message',
      '__CLILOOM_PATH_BEGIN__',
      '/home/user/.npm-global/bin:/usr/local/bin:/usr/bin',
      '__CLILOOM_PATH_END__',
      'logout message'
    ].join('\n'))).toBe('/home/user/.npm-global/bin:/usr/local/bin:/usr/bin')
  })

  it('rejects missing, empty, or multiline PATH output', () => {
    expect(parseUserShellPath('PATH=/usr/bin')).toBeUndefined()
    expect(parseUserShellPath('__CLILOOM_PATH_BEGIN__\n\n__CLILOOM_PATH_END__')).toBeUndefined()
    expect(parseUserShellPath('__CLILOOM_PATH_BEGIN__\n/a\n/b\n__CLILOOM_PATH_END__')).toBeUndefined()
  })

  it('replaces only PATH in a copied environment', () => {
    const source = { PATH: '/usr/bin', HOME: '/home/user' }
    expect(withUserShellPath(source, '/custom/bin:/usr/bin')).toEqual({
      PATH: '/custom/bin:/usr/bin',
      HOME: '/home/user'
    })
    expect(source.PATH).toBe('/usr/bin')
  })

  it('reads PATH from an interactive login shell', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'cliloom-shell-path-'))
    const shell = path.join(directory, 'test-shell')
    writeFileSync(shell, [
      '#!/bin/sh',
      '[ "$1" = "-ilc" ] || exit 2',
      "printf '__CLILOOM_PATH_BEGIN__\\n/custom/bin:/usr/bin\\n__CLILOOM_PATH_END__\\n'"
    ].join('\n'))
    chmodSync(shell, 0o700)

    try {
      await expect(readUserShellPath({ SHELL: shell, PATH: '/usr/bin' }, 'linux'))
        .resolves.toBe('/custom/bin:/usr/bin')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rebuilds and propagates PATH whenever the selected shell changes', async () => {
    let executablePath = '/bin/bash'
    const setShellEnvironment = vi.fn(() => ({ candidates: [] }))
    const consumer = { setEnvironment: vi.fn() }
    const readPath = vi.fn(async (
      _environment: NodeJS.ProcessEnv,
      _platform: NodeJS.Platform,
      shell?: { executablePath: string } | null
    ) => `/login${shell?.executablePath}/bin:/usr/bin`)
    const shellService = {
      resolveEffectiveShell: () => ({
        id: `posix:${executablePath}`,
        displayName: path.basename(executablePath),
        family: 'posix' as const,
        executablePath,
        source: 'system' as const
      }),
      setEnvironment: setShellEnvironment
    }

    const first = await rebuildRuntimeShellEnvironment({
      baseEnvironment: { PATH: '/desktop/bin', HOME: '/home/user' },
      platform: 'linux',
      shellService,
      consumers: [consumer],
      readPath: readPath as typeof readUserShellPath
    })
    executablePath = '/bin/zsh'
    const second = await rebuildRuntimeShellEnvironment({
      baseEnvironment: { PATH: '/desktop/bin', HOME: '/home/user' },
      platform: 'linux',
      shellService,
      consumers: [consumer],
      readPath: readPath as typeof readUserShellPath
    })

    expect(first.environment.PATH).toBe('/login/bin/bash/bin:/usr/bin')
    expect(second.environment.PATH).toBe('/login/bin/zsh/bin:/usr/bin')
    expect(consumer.setEnvironment).toHaveBeenLastCalledWith(second.environment)
    expect(setShellEnvironment).toHaveBeenLastCalledWith(second.environment)
    expect(readPath.mock.calls.map((call) => call[2]?.executablePath)).toEqual([
      '/bin/bash',
      '/bin/zsh'
    ])
  })
})
