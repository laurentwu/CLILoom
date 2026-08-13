import { describe, expect, it, vi } from 'vitest'
import { coordinateUpdateInstall } from './updateInstallCoordinator'

describe('coordinateUpdateInstall', () => {
  it('cleans up before allowing quit and starting the installer', async () => {
    const timeline: string[] = []

    await coordinateUpdateInstall({
      cleanup: vi.fn(async () => {
        timeline.push('cleanup')
      }),
      allowQuit: vi.fn(() => timeline.push('allow-quit')),
      disallowQuit: vi.fn(() => timeline.push('disallow-quit')),
      quitAndInstall: vi.fn(() => timeline.push('install'))
    })

    expect(timeline).toEqual(['cleanup', 'allow-quit', 'install'])
  })

  it('never allows quit or starts the installer when cleanup fails', async () => {
    const allowQuit = vi.fn()
    const quitAndInstall = vi.fn()

    await expect(coordinateUpdateInstall({
      cleanup: vi.fn(async () => {
        throw new Error('cleanup failed')
      }),
      allowQuit,
      disallowQuit: vi.fn(),
      quitAndInstall
    })).rejects.toThrow('cleanup failed')

    expect(allowQuit).not.toHaveBeenCalled()
    expect(quitAndInstall).not.toHaveBeenCalled()
  })

  it('restores quit guards when the updater cannot launch', async () => {
    const timeline: string[] = []

    await expect(coordinateUpdateInstall({
      cleanup: vi.fn(async () => {
        timeline.push('cleanup')
      }),
      allowQuit: vi.fn(() => timeline.push('allow-quit')),
      disallowQuit: vi.fn(() => timeline.push('disallow-quit')),
      quitAndInstall: vi.fn(() => {
        timeline.push('install')
        throw new Error('installer failed')
      })
    })).rejects.toThrow('installer failed')

    expect(timeline).toEqual(['cleanup', 'allow-quit', 'install', 'disallow-quit'])
  })
})
