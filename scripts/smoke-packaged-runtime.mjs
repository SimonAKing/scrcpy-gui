import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'

const projectRoot = resolve(import.meta.dirname, '..')
const releaseDirectory = join(projectRoot, 'release')
const archiveSuffix = process.platform === 'darwin'
  ? `-mac-${process.arch}.zip`
  : process.platform === 'win32'
    ? `-win-${process.arch}.zip`
    : `-linux-${process.arch}.tar.gz`

async function walk(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await walk(path))
    else if (entry.isFile()) result.push(path)
  }
  return result
}

function run(executable, args, expected) {
  const result = spawnSync(executable, args, { encoding: 'utf8', windowsHide: true })
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim()
  if (result.error || result.status !== 0 || !expected.test(output)) {
    throw new Error(`Packaged runtime smoke failed for ${basename(executable)} (${result.status ?? 'spawn error'}).\n${output}\n${result.error || ''}`)
  }
  console.log(output.split(/\r?\n/)[0])
}

const archive = (await readdir(releaseDirectory))
  .find((name) => name.startsWith('Scrcpy.GUI-') && name.endsWith(archiveSuffix))
if (!archive) throw new Error(`No current-architecture packaged archive matches *${archiveSuffix}.`)

const temporary = await mkdtemp(join(tmpdir(), 'scrcpy-gui-package-smoke-'))
try {
  const extraction = spawnSync('tar', ['-xf', join(releaseDirectory, archive), '-C', temporary], { stdio: 'inherit', windowsHide: true })
  if (extraction.error || extraction.status !== 0) throw extraction.error || new Error(`Could not extract ${archive}.`)
  const files = await walk(temporary)
  const executableName = process.platform === 'win32' ? 'scrcpy.exe' : 'scrcpy'
  const adbName = process.platform === 'win32' ? 'adb.exe' : 'adb'
  const runtimeFile = (name) => files.find((path) => basename(path) === name && dirname(path).split(sep).includes('scrcpy'))
  const scrcpy = runtimeFile(executableName)
  const adb = runtimeFile(adbName)
  if (!scrcpy || !adb) throw new Error('The packaged archive does not contain both scrcpy and adb under Resources/scrcpy.')
  run(scrcpy, ['--version'], /^scrcpy\s+4\.1\b/im)
  run(adb, ['version'], /^Android Debug Bridge version\s+1\.0\.41\b/im)
  console.log(`Verified packaged runtime from ${archive}.`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
