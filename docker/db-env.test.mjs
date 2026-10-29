import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { assertStorageOwnership, root } from '../scripts/db-env.mjs'

const mount = { Type: 'volume', Name: 'tradeledger-postgres-v1', Destination: '/var/lib/postgresql/data' }
const container = { Mounts: [mount] }
const volume = {
  Name: 'tradeledger-postgres-v1',
  Labels: {
    'com.tradeledger.owner': 'tradeledger-local-stack-v1',
    'com.docker.compose.project': 'tradeledger',
    'com.docker.compose.volume': 'database',
  },
}

test('accepts the exact named data volume with all ownership labels', () => {
  assert.doesNotThrow(() => assertStorageOwnership(container, volume))
})

for (const [name, replacement] of [
  ['unknown volume', { ...mount, Name: 'unknown-volume' }],
  ['bind mount', { ...mount, Type: 'bind' }],
  ['wrong destination', { ...mount, Destination: '/unrelated/data' }],
]) {
  test(`rejects ${name} without changing inspection objects`, () => {
    const candidate = { Mounts: [replacement] }
    const before = structuredClone(candidate)
    assert.throws(() => assertStorageOwnership(candidate, volume), /data mount/)
    assert.deepEqual(candidate, before)
  })
}

test('rejects missing data mount', () => {
  assert.throws(() => assertStorageOwnership({ Mounts: [] }, volume), /data mount/)
})

test('rejects an extra nested mount that could redirect database writes', () => {
  assert.throws(() => assertStorageOwnership({ Mounts: [mount, { ...mount, Name: 'foreign', Destination: `${mount.Destination}/base` }] }, volume), /data mount/)
})

for (const label of Object.keys(volume.Labels)) {
  test(`rejects foreign or missing ${label}`, () => {
    const foreign = { ...volume, Labels: { ...volume.Labels, [label]: 'foreign' } }
    assert.throws(() => assertStorageOwnership(container, foreign), /volume ownership/)
    const missing = { ...volume, Labels: Object.fromEntries(Object.entries(volume.Labels).filter(([key]) => key !== label)) }
    assert.throws(() => assertStorageOwnership(container, missing), /volume ownership/)
  })
}

test('rejects missing or mismatched inspected volume', () => {
  assert.throws(() => assertStorageOwnership(container, undefined), /volume ownership/)
  assert.throws(() => assertStorageOwnership(container, { ...volume, Name: 'foreign' }), /volume ownership/)
})

test('runtime command helper forwards inherited stdin to the child', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import process from 'node:process'
    import { run } from './scripts/db-env.mjs'
    await run(process.execPath, ['-'], { inheritInput: true })
  `], { cwd: root, input: "process.stdout.write('stdin reached child')", encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'stdin reached child')
})
