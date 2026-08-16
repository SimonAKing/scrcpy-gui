import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const executable = process.platform === 'win32' ? 'scrcpy.exe' : 'scrcpy'
const adbExecutable = process.platform === 'win32' ? 'adb.exe' : 'adb'
const runtimeDirectory = join(projectRoot, 'vendor', `scrcpy-${process.arch}`)

function run(name, args, expected) {
  const path = join(runtimeDirectory, name)
  const result = spawnSync(path, args, { encoding: 'utf8', windowsHide: true })
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim()
  if (result.error || result.status !== 0 || !expected.test(output)) {
    throw new Error(`Prepared runtime smoke failed for ${name} (${result.status ?? 'spawn error'}).\n${output}\n${result.error || ''}`)
  }
  console.log(output.split(/\r?\n/)[0])
}

run(executable, ['--version'], /^scrcpy\s+4\.1\b/im)
run(adbExecutable, ['version'], /^Android Debug Bridge version\s+1\.0\.41\b/im)
console.log(`Verified prepared runtime in vendor/scrcpy-${process.arch}.`)
