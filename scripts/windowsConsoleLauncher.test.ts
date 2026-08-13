import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

type WindowsConsoleLauncherModule = {
  WINDOWS_CONSOLE_SUBSYSTEM: number
  WINDOWS_GUI_SUBSYSTEM: number
  normalizeWindowsArchitecture: (value: unknown) => 'x64' | 'arm64'
  readPeSubsystemFromBuffer: (buffer: Buffer) => number
}

const {
  WINDOWS_CONSOLE_SUBSYSTEM,
  WINDOWS_GUI_SUBSYSTEM,
  normalizeWindowsArchitecture,
  readPeSubsystemFromBuffer
} = require('./build-windows-console-launcher.cjs') as WindowsConsoleLauncherModule

function createPeFixture(magic: 0x10b | 0x20b, subsystem: number): Buffer {
  const buffer = Buffer.alloc(512)
  const peOffset = 0x80
  const optionalHeaderOffset = peOffset + 24
  buffer.write('MZ', 0, 'ascii')
  buffer.writeUInt32LE(peOffset, 0x3c)
  buffer.write('PE\0\0', peOffset, 'ascii')
  buffer.writeUInt16LE(magic === 0x10b ? 0xe0 : 0xf0, peOffset + 20)
  buffer.writeUInt16LE(magic, optionalHeaderOffset)
  buffer.writeUInt16LE(subsystem, optionalHeaderOffset + 68)
  return buffer
}

describe('Windows Console launcher packaging', () => {
  it('reads GUI and Console subsystem values from PE32 and PE32+ images', () => {
    expect(readPeSubsystemFromBuffer(createPeFixture(0x10b, WINDOWS_GUI_SUBSYSTEM)))
      .toBe(2)
    expect(readPeSubsystemFromBuffer(createPeFixture(0x20b, WINDOWS_CONSOLE_SUBSYSTEM)))
      .toBe(3)
  })

  it('rejects malformed and unsupported executable headers', () => {
    expect(() => readPeSubsystemFromBuffer(Buffer.alloc(512))).toThrow(/DOS header/)
    const unsupported = createPeFixture(0x10b, WINDOWS_CONSOLE_SUBSYSTEM)
    unsupported.writeUInt16LE(0x999, 0x80 + 24)
    expect(() => readPeSubsystemFromBuffer(unsupported)).toThrow(/unsupported PE optional header/)
  })

  it('maps only the supported electron-builder Windows architectures', () => {
    expect(normalizeWindowsArchitecture('x64')).toBe('x64')
    expect(normalizeWindowsArchitecture(1)).toBe('x64')
    expect(normalizeWindowsArchitecture('arm64')).toBe('arm64')
    expect(normalizeWindowsArchitecture(3)).toBe('arm64')
    expect(() => normalizeWindowsArchitecture('ia32')).toThrow(/Unsupported/)
  })

  it('declares a static-runtime Console target that explicitly inherits standard handles', () => {
    const project = readFileSync(
      new URL('../native/windows/cliloom-cli.vcxproj', import.meta.url),
      'utf8'
    )
    const source = readFileSync(
      new URL('../native/windows/cliloom-cli.cc', import.meta.url),
      'utf8'
    )

    expect(project).toContain('<SubSystem>Console</SubSystem>')
    expect(project).toContain('<RuntimeLibrary>MultiThreaded</RuntimeLibrary>')
    expect(project).toContain('<Platform>ARM64</Platform>')
    expect(source).toContain('DuplicateHandle(')
    expect(source).toContain('CreateNamedPipeW(')
    expect(source).toContain('CreateThread(')
    expect(source).toContain('STARTF_USESTDHANDLES')
    expect(source).toContain('CreateProcessW(')
  })
})
