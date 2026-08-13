import { describe, expect, it } from 'vitest'
import { getPrereleaseChannel, isReleaseVersion } from './update'

describe('update versions', () => {
  it('accepts repository release versions and extracts prerelease channels', () => {
    expect(isReleaseVersion('0.1.0')).toBe(true)
    expect(isReleaseVersion('0.2.0-beta.3')).toBe(true)
    expect(isReleaseVersion('1.0.0+build.7')).toBe(true)
    expect(getPrereleaseChannel('0.2.0-alpha.1')).toBe('alpha')
    expect(getPrereleaseChannel('0.2.0-rc.2')).toBe('rc')
    expect(getPrereleaseChannel('0.2.0')).toBeNull()
  })

  it('rejects versions that cannot map to an immutable release tag', () => {
    expect(isReleaseVersion('v0.1.0')).toBe(false)
    expect(isReleaseVersion('01.0.0')).toBe(false)
    expect(isReleaseVersion('../0.1.0')).toBe(false)
    expect(getPrereleaseChannel('not-a-version')).toBeNull()
  })
})
