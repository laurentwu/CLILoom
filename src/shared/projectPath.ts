export function isUnsupportedProjectPath(value: unknown): boolean {
  if (typeof value !== 'string') return false
  let normalized = value.replaceAll('/', '\\')
  const devicePrefix = normalized.slice(0, 8).toLocaleLowerCase('en-US')
  if (devicePrefix === '\\\\?\\unc\\' || devicePrefix === '\\\\.\\unc\\') {
    normalized = `\\\\${normalized.slice(8)}`
  }
  return /^\\\\(?:wsl\$|wsl\.localhost)(?:\\|$)/i.test(normalized)
}
