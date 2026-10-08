/**
 * Runs every test/*.test.mjs suite, each in its own Node process, and exits
 * non-zero if ANY of them failed.
 *
 * Replaces a `node a && node b && ...` chain, where one suite failing - or
 * merely crashing on exit after passing - stopped every suite after it. That
 * made a healthy run look like a failure and hid real failures further down.
 * Here every suite runs regardless, and the summary names each one that did
 * not exit 0.
 *
 * Suites are discovered by filename, so a new one cannot be forgotten.
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))

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

console.log(`\n=== ${suites.length - failures.length}/${suites.length} suites passed`)
for (const failure of failures) console.log(`FAILED  ${failure}`)

process.exitCode = failures.length === 0 ? 0 : 1
