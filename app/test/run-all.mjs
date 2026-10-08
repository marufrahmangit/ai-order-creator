/**
 * Runs every test/*.test.mjs suite, each in its own Node process, and the
 * plugin's PHP suites (tests/**\/*.test.php at the repo root) when a PHP is
 * available. Exits non-zero if ANY suite that ran failed.
 *
 * Replaces a `node a && node b && ...` chain, where one suite failing - or
 * merely crashing on exit after passing - stopped every suite after it. That
 * made a healthy run look like a failure and hid real failures further down.
 * Here every suite runs regardless, and the summary names each one that did
 * not exit 0.
 *
 * Suites are discovered by filename, so a new one cannot be forgotten.
 *
 * PHP: set PHP_BIN to a php executable, or have `php` on the PATH. mbstring is
 * loaded from the executable's own ext/ directory if it is not on already,
 * which is what a portable Windows PHP needs. With no usable PHP the PHP
 * suites are reported as SKIPPED - by name, in the summary - never silently
 * dropped. Set REQUIRE_PHP=1 to make a skip a failure.
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.join(DIR, '..', '..')

const suites = fs
  .readdirSync(DIR)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()

if (suites.length === 0) {
  console.error('No test suites found.')
  process.exit(1)
}

const failures = []

for (const suite of suites) {
  console.log(`\n=== ${suite}`)
  const result = spawnSync(process.execPath, [path.join(DIR, suite)], { stdio: 'inherit' })

  if (result.status !== 0) {
    const why = result.error
      ? result.error.message
      : result.signal
        ? `signal ${result.signal}`
        : `exit ${result.status}`
    failures.push(`${suite} (${why})`)
  }
}

// ---- PHP suites --------------------------------------------------------------

function findPhpSuites(dir) {
  if (!fs.existsSync(dir)) return []
  const found = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...findPhpSuites(full))
    else if (entry.name.endsWith('.test.php')) found.push(full)
  }
  return found.sort()
}

/**
 * A PHP that can run the parser, as [executable, ...args], or a reason why not.
 *
 * @returns {{command: string[]} | {reason: string}}
 */
function locatePhp() {
  const bin = process.env.PHP_BIN || 'php'
  const probe = (args) => spawnSync(bin, [...args, '-r', "echo extension_loaded('mbstring') ? 'yes' : 'no';"], { encoding: 'utf8' })

  const plain = probe([])
  if (plain.error || plain.status !== 0) {
    return { reason: process.env.PHP_BIN ? `PHP_BIN (${bin}) did not run` : 'no PHP found - set PHP_BIN to a php executable' }
  }
  if (plain.stdout.trim() === 'yes') return { command: [bin] }

  // A portable PHP ships mbstring but does not load it by default.
  const ext = path.join(path.dirname(bin), 'ext')
  const args = ['-d', `extension_dir=${ext}`, '-d', 'extension=mbstring']
  const loaded = probe(args)
  if (!loaded.error && loaded.status === 0 && loaded.stdout.trim() === 'yes') return { command: [bin, ...args] }

  return { reason: `${bin} runs, but mbstring cannot be loaded, and the parser needs it` }
}

const phpSuites = findPhpSuites(path.join(REPO, 'tests'))
const skipped = []

if (phpSuites.length > 0) {
  const php = locatePhp()
  for (const suite of phpSuites) {
    const name = path.relative(REPO, suite).split(path.sep).join('/')
    if ('reason' in php) {
      console.log(`\n=== ${name}\nSKIPPED  ${php.reason}`)
      skipped.push(`${name} (${php.reason})`)
      continue
    }

    console.log(`\n=== ${name}`)
    const [bin, ...args] = php.command
    const result = spawnSync(bin, [...args, suite], { stdio: 'inherit' })
    if (result.status !== 0) {
      failures.push(`${name} (${result.error ? result.error.message : `exit ${result.status}`})`)
    }
  }
}

// ---- summary -------------------------------------------------------------------

const ran = suites.length + phpSuites.length - skipped.length
console.log(`\n=== ${ran - failures.length}/${ran} suites passed`)
for (const failure of failures) console.log(`FAILED   ${failure}`)
for (const skip of skipped) console.log(`SKIPPED  ${skip}`)

const skipIsFailure = skipped.length > 0 && process.env.REQUIRE_PHP === '1'
if (skipIsFailure) console.log('REQUIRE_PHP=1, so a skipped PHP suite counts as a failure.')

process.exitCode = failures.length === 0 && !skipIsFailure ? 0 : 1
