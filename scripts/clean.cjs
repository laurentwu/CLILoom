'use strict'

const fs = require('node:fs')
const path = require('node:path')

/** @typedef {'build' | 'main' | 'all'} CleanupScope */

const VALID_SCOPES = /** @type {const} */ (['build', 'main', 'all'])

const USAGE_MESSAGE = 'Usage: node scripts/clean.cjs <build|main|all>'

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
 * Compute, validate and remove every generated artifact for the given scope.
 *
 * All targets are resolved and containment-checked before any deletion begins,
 * so a validation failure never leaves a partially cleaned tree behind.
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
    const display = path.relative(root, target) || path.basename(target)
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
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
