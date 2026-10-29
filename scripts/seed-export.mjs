import process from 'node:process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { demoDocument } from './seed-demo-data.mjs'

try {
  if (process.argv.length > 2) throw new Error('No arguments accepted.')
  const directory = new URL('../.cache/', import.meta.url)
  const target = new URL('demo-seed-v1.json', directory)
  const json = `${JSON.stringify(demoDocument(), null, 2)}\n`
  await mkdir(directory, { recursive: true })
  try { await writeFile(target, json, { flag: 'wx' }) }
  catch (error) {
    if (error.code !== 'EEXIST' || await readFile(target, 'utf8') !== json) {
      throw new Error('Seed export target already contains different data; preserving it.', { cause: error })
    }
  }
  process.stdout.write(`Demo backup: ${fileURLToPath(target)}\n`)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Demo export failed'}\n`)
  process.exitCode = 1
}
