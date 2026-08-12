import { describe, expect, it } from 'vitest'
import { isUnsupportedProjectPath } from './projectPath'

describe('isUnsupportedProjectPath', () => {
  it.each([
    '\\\\wsl$',
    '\\\\wsl.localhost',
    '\\\\wsl$\\',
    '\\\\wsl.localhost\\',
    '\\\\WsL$\\Ubuntu\\home\\me\\repo',
    '//WSL.LOCALHOST/Ubuntu/home/me/repo',
    '\\\\?\\UNC\\wsl$\\Ubuntu\\home\\me\\repo',
    '\\\\.\\UNC\\wsl.localhost\\Ubuntu\\home\\me\\repo'
  ])('rejects the WSL namespace form %s', (value) => {
    expect(isUnsupportedProjectPath(value)).toBe(true)
  })

  it.each([
    '\\\\wsl$evil\\share',
    '\\\\wsl.localhost.example\\share',
    '\\\\server\\share',
    'C:\\repo',
    '/repo',
    '',
    null,
    undefined,
    42,
    {}
  ])('does not reject the unrelated value %s', (value) => {
    expect(isUnsupportedProjectPath(value)).toBe(false)
  })
})
