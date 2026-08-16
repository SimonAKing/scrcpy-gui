import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'

const projectRoot = resolve(import.meta.dirname, '..')
const releaseDirectory = join(projectRoot, 'release')
const packageVersion = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')).version
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
  .find((name) => name.startsWith(`Scrcpy.GUI-${packageVersion}-`) && name.endsWith(archiveSuffix))
if (!archive) throw new Error(`No v${packageVersion} current-architecture packaged archive matches *${archiveSuffix}.`)

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
  const runtimeLicense = runtimeFile(process.platform === 'win32' ? 'LICENSE.txt' : 'LICENSE')
  const guiLicense = files.find((path) => basename(path) === 'LICENSE.scrcpy-gui.txt')
  const thirdPartyNotices = files.find((path) => basename(path) === 'THIRD_PARTY_NOTICES.md')
  if (!scrcpy || !adb || !runtimeLicense || !guiLicense || !thirdPartyNotices) {
    throw new Error('The packaged archive does not contain scrcpy, adb, the upstream runtime license, the Scrcpy GUI license, and third-party notices.')
  }
  const [runtimeLicenseText, guiLicenseText] = await Promise.all([
    readFile(runtimeLicense, 'utf8'),
    readFile(guiLicense, 'utf8')
  ])
  if (!/Apache License\s+Version 2\.0/s.test(runtimeLicenseText)) {
    throw new Error('The packaged archive does not preserve the expected scrcpy Apache-2.0 license text.')
  }
  if (!/^MIT License\r?\n/.test(guiLicenseText)) {
    throw new Error('The packaged archive does not preserve the expected Scrcpy GUI MIT license text.')
  }
  run(scrcpy, ['--version'], /^scrcpy\s+4\.1\b/im)
  run(adb, ['version'], /^Android Debug Bridge version\s+1\.0\.41\b/im)
  console.log(`Verified packaged runtime from ${archive}.`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
