'use strict'

const fs = require('node:fs')
const path = require('node:path')

/** @typedef {'build' | 'main' | 'all'} CleanupScope */

const VALID_SCOPES = /** @type {const} */ (['build', 'main', 'all'])

const USAGE_MESSAGE = 'Usage: node scripts/clean.cjs <build|main|all>'
const CLEANUP_MAX_RETRIES = 3
const CLEANUP_RETRY_DELAY_MS = 100
const RETRYABLE_CLEANUP_ERROR_CODES = new Set([
  'EBUSY',
  'EMFILE',
  'ENFILE',
  'ENOTEMPTY',
  'EPERM'
])
const CLEANUP_RETRY_WAIT_BUFFER = new Int32Array(new SharedArrayBuffer(4))

/**
 * Read-only cleanup target configuration keyed by scope.
 *
 * - `paths` are project-root-relative entries removed recursively.
 * - `rootSuffixes` lists file-name suffixes; matching root-level regular
 *   files or symbolic links (never directories) are removed.
 *
 * @type {Readonly<Record<CleanupScope, Readonly<{ paths: ReadonlyArray<string>; rootSuffixes: ReadonlyArray<string> }>>>}
 */
const CLEANUP_TARGETS = Object.freeze({
  build: Object.freeze({
    paths: Object.freeze(['dist', '.vite']),
    rootSuffixes: Object.freeze(['.tsbuildinfo'])
  }),
  main: Object.freeze({
    paths: Object.freeze(['dist/main', 'dist/tsconfig.main.tsbuildinfo']),
    rootSuffixes: Object.freeze([])
  }),
  all: Object.freeze({
    paths: Object.freeze([
      'dist',
      '.vite',
      'release',
      'out',
      'coverage',
      'playwright-report',
      'test-results'
    ]),
    rootSuffixes: Object.freeze(['.tsbuildinfo'])
  })
})

/**
 * Resolve and validate a single cleanup target so it can never escape the
 * project root.
 *
 * @param {string} projectRoot
 * @param {string} relativePath
 * @returns {string}
 */
function resolveCleanupTarget(projectRoot, relativePath) {
  const resolvedRoot = path.resolve(projectRoot)
  const target = path.resolve(resolvedRoot, relativePath)
  if (target === resolvedRoot) {
    throw new Error(`Refusing to clean the project root: ${relativePath}`)
  }
  const prefix = resolvedRoot + path.sep
  if (!target.startsWith(prefix)) {
    throw new Error(`Refusing to clean a path outside the project root: ${relativePath}`)
  }
  return target
}

/**
 * @param {string[]} argv
 * @returns {CleanupScope}
 */
function parseCleanupScope(argv) {
  if (!Array.isArray(argv) || argv.length !== 1 || !VALID_SCOPES.includes(argv[0])) {
    throw new Error(USAGE_MESSAGE)
  }
  return /** @type {CleanupScope} */ (argv[0])
}

/**
 * Return information about an existing entry without following symbolic
 * links. A non-directory parent means the requested entry cannot exist.
 *
 * @param {string} target
 * @returns {import('node:fs').Stats | undefined}
 */
function lstatIfPresent(target) {
  try {
    return fs.lstatSync(target)
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return undefined
    }
    throw error
  }
}

/**
 * Refuse a target reached through a symbolic link below the project root.
 * Checking only the target itself is insufficient for paths such as
 * `dist/main` when `dist` is a Windows junction to an external directory.
 *
 * @param {string} root
 * @param {string} target
 * @returns {void}
 */
function assertNoSymbolicLinkAncestors(root, target) {
  const relativeParent = path.relative(root, path.dirname(target))
  if (relativeParent === '') return

  let current = root
  for (const segment of relativeParent.split(path.sep)) {
    current = path.join(current, segment)
    const stats = lstatIfPresent(current)
    if (!stats) return
    if (stats.isSymbolicLink()) {
      throw new Error(
        `Refusing to clean through a symbolic link: ${path.relative(root, current)}`
      )
    }
    if (!stats.isDirectory()) return
  }
}

/**
 * Retry a synchronous removal operation with the same bounded linear backoff
 * previously provided by recursive rmSync. ENOENT is accepted so concurrent
 * removal keeps the original force semantics.
 *
 * @param {() => void} operation
 * @returns {void}
 */
function retryCleanupOperation(operation) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      operation()
      return
    } catch (error) {
      if (error && error.code === 'ENOENT') return
      if (
        !error ||
        !RETRYABLE_CLEANUP_ERROR_CODES.has(error.code) ||
        attempt >= CLEANUP_MAX_RETRIES
      ) {
        throw error
      }
      Atomics.wait(
        CLEANUP_RETRY_WAIT_BUFFER,
        0,
        0,
        (attempt + 1) * CLEANUP_RETRY_DELAY_MS
      )
    }
  }
}

/**
 * Remove an entry recursively without ever traversing a symbolic link.
 * Node reports Windows directory junctions as symbolic links through lstat,
 * so unlinking them explicitly preserves the linked directory and contents.
 *
 * @param {string} target
 * @returns {void}
 */
function removeCleanupEntry(target) {
  const stats = lstatIfPresent(target)
  if (!stats) return

  if (!stats.isDirectory()) {
    retryCleanupOperation(() => fs.unlinkSync(target))
    return
  }

  for (const entry of fs.readdirSync(target)) {
    removeCleanupEntry(path.join(target, entry))
  }

  retryCleanupOperation(() => fs.rmdirSync(target))
}

/**
 * Compute, validate and remove every generated artifact for the given scope.
 *
 * All targets are resolved, containment-checked and checked for linked parent
 * directories before any deletion begins, so a validation failure never
 * leaves a partially cleaned tree behind.
 *
 * @param {CleanupScope} scope
 * @param {string} [projectRoot]
 * @returns {void}
 */
function cleanGeneratedArtifacts(scope, projectRoot) {
  const config = CLEANUP_TARGETS[scope]
  if (!config) {
    throw new Error(`Unknown cleanup scope: ${String(scope)}`)
  }

  const root = path.resolve(projectRoot !== undefined ? projectRoot : path.resolve(__dirname, '..'))

  /** @type {string[]} */
  const targets = []
  for (const relativePath of config.paths) {
    targets.push(resolveCleanupTarget(root, relativePath))
  }

  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error
    entries = []
  }
  for (const entry of entries) {
    const matchesSuffix = config.rootSuffixes.some((suffix) => entry.name.endsWith(suffix))
    if (!matchesSuffix) continue
    if (!entry.isFile() && !entry.isSymbolicLink()) continue
    targets.push(resolveCleanupTarget(root, entry.name))
  }

  const uniqueTargets = Array.from(new Set(targets))

  for (const target of uniqueTargets) {
    assertNoSymbolicLinkAncestors(root, target)
  }

  for (const target of uniqueTargets) {
    const display = path.relative(root, target) || path.basename(target)
    removeCleanupEntry(target)
    console.log(`cleaned ${display}`)
  }
}

module.exports = {
  cleanGeneratedArtifacts,
  resolveCleanupTarget,
  parseCleanupScope,
  CLEANUP_TARGETS
}

if (require.main === module) {
  try {
    const scope = parseCleanupScope(process.argv.slice(2))
    cleanGeneratedArtifacts(scope, path.resolve(__dirname, '..'))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
