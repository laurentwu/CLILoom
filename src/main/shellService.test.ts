import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SHELL_PREFERENCES,
  type DetectedShell,
  type ShellPreferences
} from '../shared/shell'
import type { SettingsService } from './settingsService'
import {
  ShellService,
  createShellId,
  discoverShells,
  selectDefaultShell,
  type ShellProbe
} from './shellService'

function createProbe(
  files: Map<string, string>,
  shellsFile = ''
): ShellProbe {
  return {
    inspect(candidatePath, platform) {
      const key = platform === 'win32' ? candidatePath.toLowerCase() : candidatePath
      const realPath = files.get(key)
      return realPath ? { realPath } : null
    },
    readText(filePath) {
      return filePath === '/etc/shells' ? shellsFile : null
    }
  }
}

function createSettings(initial: ShellPreferences = DEFAULT_SHELL_PREFERENCES): {
  service: SettingsService
  getPreferences: () => ShellPreferences
} {
  let preferences = initial
  const service = {
    getSnapshot: () => ({ shell: preferences }),
    setShellPreferences: (next: ShellPreferences) => {
      preferences = next
      return next
    }
  } as unknown as SettingsService
  return { service, getPreferences: () => preferences }
}

describe('shell discovery', () => {
  it('discovers and prioritizes native Windows shells without executing a shell', () => {
    const files = new Map([
      ['c:\\tools\\pwsh.exe', 'C:\\Tools\\pwsh.exe'],
      ['c:\\windows\\system32\\windowspowershell\\v1.0\\powershell.exe', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'],
      ['c:\\windows\\system32\\cmd.exe', 'C:\\Windows\\System32\\cmd.exe'],
      ['c:\\program files\\git\\bin\\bash.exe', 'C:\\Program Files\\Git\\bin\\bash.exe']
    ])
    const candidates = discoverShells({
      platform: 'win32',
      environment: {
        PATH: 'C:\\Tools;C:\\Windows\\System32\\WindowsPowerShell\\v1.0;C:\\Windows\\System32',
        ComSpec: 'C:\\Windows\\System32\\cmd.exe',
        ProgramFiles: 'C:\\Program Files'
      },
      probe: createProbe(files)
    })

    expect(candidates.map((shell) => shell.displayName)).toEqual([
      'PowerShell 7',
      'Windows PowerShell',
      'Command Prompt',
      'Git Bash'
    ])
    expect(selectDefaultShell(candidates, 'win32')?.displayName).toBe('PowerShell 7')
  })

  it('does not trust an arbitrary executable supplied through ComSpec', () => {
    const files = new Map([
      ['c:\\tools\\pretend.exe', 'C:\\Tools\\pretend.exe'],
      ['c:\\windows\\system32\\cmd.exe', 'C:\\Windows\\System32\\cmd.exe']
    ])
    const candidates = discoverShells({
      platform: 'win32',
      environment: {
        PATH: 'C:\\Windows\\System32',
        PATHEXT: '.EXE',
        ComSpec: 'C:\\Tools\\pretend.exe'
      },
      probe: createProbe(files)
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0].family).toBe('cmd')
    expect(candidates[0].executablePath.toLowerCase()).toBe(
      'c:\\windows\\system32\\cmd.exe'
    )
  })

  it('deduplicates real files while keeping IDs stable for the launch path', () => {
    const files = new Map([
      ['/bin/bash', '/targets/bash-v1'],
      ['/usr/bin/bash', '/targets/bash-v1'],
      ['/bin/sh', '/targets/sh']
    ])
    const first = discoverShells({
      platform: 'linux',
      environment: { SHELL: '/bin/bash', PATH: '/usr/bin:/bin' },
      probe: createProbe(files, '/bin/bash\n/bin/sh')
    })
    files.set('/bin/bash', '/targets/bash-v2')
    files.set('/usr/bin/bash', '/targets/bash-v2')
    const second = discoverShells({
      platform: 'linux',
      environment: { SHELL: '/bin/bash', PATH: '/usr/bin:/bin' },
      probe: createProbe(files, '/bin/bash\n/bin/sh')
    })

    expect(first.filter((shell) => shell.displayName === 'bash')).toHaveLength(1)
    expect(second.find((shell) => shell.displayName === 'bash')?.id).toBe(
      first.find((shell) => shell.displayName === 'bash')?.id
    )
    expect(createShellId('posix', '/bin/bash', 'linux')).toBe('posix:%2Fbin%2Fbash')
  })

  it('uses the confirmed platform-specific default order', () => {
    const candidates: DetectedShell[] = [
      { id: 'sh', displayName: 'sh', family: 'posix', executablePath: '/bin/sh', source: 'system' },
      { id: 'zsh', displayName: 'zsh', family: 'posix', executablePath: '/bin/zsh', source: 'login-shell' },
      { id: 'bash', displayName: 'bash', family: 'posix', executablePath: '/bin/bash', source: 'system' }
    ]
    expect(selectDefaultShell(candidates, 'darwin', { SHELL: '/bin/bash' })?.id).toBe('zsh')
    expect(selectDefaultShell(candidates, 'linux', { SHELL: '/bin/zsh' })?.id).toBe('bash')
  })

  it('uses PATHEXT for Windows PATH discovery and tolerates missing environment inputs', () => {
    const files = new Map([
      ['c:\\tools\\pwsh.exe', 'C:\\Tools\\pwsh.exe']
    ])

    expect(discoverShells({
      platform: 'win32',
      environment: { Path: 'C:\\Tools', PATHEXT: '.EXE' },
      probe: createProbe(files)
    }).map((shell) => shell.displayName)).toEqual(['PowerShell 7'])
    expect(discoverShells({
      platform: 'win32',
      environment: { PATH: 'C:\\Tools', PATHEXT: '.CMD' },
      probe: createProbe(files)
    })).toEqual([])
    expect(discoverShells({
      platform: 'linux',
      environment: {},
      probe: createProbe(new Map())
    })).toEqual([])
  })

  it('discovers supported login shells but excludes unsupported entries', () => {
    const files = new Map([
      ['/bin/zsh', '/bin/zsh'],
      ['/opt/homebrew/bin/fish', '/opt/homebrew/bin/fish'],
      ['/bin/sh', '/bin/sh']
    ])
    const candidates = discoverShells({
      platform: 'darwin',
      environment: { SHELL: '/bin/zsh' },
      probe: createProbe(files, '/bin/zsh\n/opt/homebrew/bin/fish\n/bin/sh')
    })

    expect(candidates.map((shell) => shell.displayName)).toEqual(['zsh', 'sh'])
    expect(selectDefaultShell(candidates, 'darwin', { SHELL: '/bin/zsh' })?.displayName).toBe('zsh')
  })
})

describe('ShellService selection', () => {
  it('rejects a WSL UNC project before a native Windows target can use it as cwd', async () => {
    const settings = createSettings()
    const service = new ShellService({
      settingsService: settings.service,
      platform: 'win32',
      environment: {},
      probe: createProbe(new Map())
    })

    await expect(service.resolveProjectPath({
      id: 'cmd:C%3A%5CWindows%5CSystem32%5Ccmd.exe',
      displayName: 'Command Prompt',
      family: 'cmd',
      executablePath: 'C:\\Windows\\System32\\cmd.exe',
      source: 'comspec'
    }, '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo'))
      .rejects.toThrow('This project path is not supported')
  })

  it('persists explicit selection and blocks launch when it disappears', () => {
    const files = new Map([
      ['/bin/bash', '/bin/bash'],
      ['/bin/sh', '/bin/sh']
    ])
    const settings = createSettings()
    const service = new ShellService({
      settingsService: settings.service,
      platform: 'linux',
      environment: { PATH: '/bin' },
      probe: createProbe(files)
    })
    const bash = service.getSnapshot().candidates.find((shell) => shell.displayName === 'bash')!

    expect(service.select(bash.id).effectiveShell?.id).toBe(bash.id)
    expect(settings.getPreferences().selection.mode).toBe('explicit')
    files.delete('/bin/bash')

    expect(() => service.resolveEffectiveShell()).toThrow('The selected shell is unavailable')
    const unavailable = service.getSnapshot()
    expect(unavailable.effectiveShell).toBeNull()
    expect(unavailable.preferences.selection).toMatchObject({
      mode: 'explicit',
      shell: { displayName: 'bash', executablePath: '/bin/bash' }
    })
    expect(unavailable.error).toContain('The selected shell is unavailable')

    const restarted = new ShellService({
      settingsService: settings.service,
      platform: 'linux',
      environment: { PATH: '/bin' },
      probe: createProbe(files)
    })
    expect(restarted.getSnapshot().effectiveShell).toBeNull()
    expect(() => restarted.resolveEffectiveShell()).toThrow('The selected shell is unavailable')
  })

  it('allows automatic mode to recompute a fallback', () => {
    const files = new Map([['/bin/sh', '/bin/sh']])
    const settings = createSettings()
    const service = new ShellService({
      settingsService: settings.service,
      platform: 'linux',
      environment: { PATH: '/bin' },
      probe: createProbe(files)
    })

    expect(service.resolveEffectiveShell().displayName).toBe('sh')
    expect(service.select('automatic').preferences.selection.mode).toBe('automatic')
  })

  it('rejects renderer-provided IDs outside the freshly detected catalog', () => {
    const settings = createSettings()
    const service = new ShellService({
      settingsService: settings.service,
      platform: 'linux',
      environment: { PATH: '/bin' },
      probe: createProbe(new Map([['/bin/sh', '/bin/sh']]))
    })

    expect(() => service.select('posix:%2Ftmp%2Fevil-shell')).toThrow(
      'Only currently detected and supported shells can be selected'
    )
    expect(settings.getPreferences()).toEqual(DEFAULT_SHELL_PREFERENCES)
  })

  it('refreshes only the native shell catalog', async () => {
    const files = new Map([['/bin/sh', '/bin/sh']])
    const settings = createSettings()
    const service = new ShellService({
      settingsService: settings.service,
      platform: 'linux',
      environment: { PATH: '/bin' },
      probe: createProbe(files)
    })

    expect((await service.refresh()).candidates).toEqual([
      expect.objectContaining({ displayName: 'sh', executablePath: '/bin/sh' })
    ])
  })
})
