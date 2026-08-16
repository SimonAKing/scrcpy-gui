import { createHash } from 'node:crypto'
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const VERSION = '4.1'
const RELEASE_BASE = `https://github.com/Genymobile/scrcpy/releases/download/v${VERSION}`
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const platform = process.argv[2] || process.platform
const licenseName = platform === 'win32' ? 'LICENSE.txt' : 'LICENSE'

const artifacts = {
  darwin: [
    { file: `scrcpy-macos-x86_64-v${VERSION}.tar.gz`, arch: 'x64', sha256: 'ee2a7223bc8dbdc4f482db1134bcf441178dafb833492b71ca4c22090c58ce72' },
    { file: `scrcpy-macos-aarch64-v${VERSION}.tar.gz`, arch: 'arm64', sha256: '20fd47c9014dd5e0fa77091f3cb7adbda8445a360c4584aeaa0150b5b3988ff3' }
  ],
  win32: [
    { file: `scrcpy-win64-v${VERSION}.zip`, arch: 'x64', sha256: '5b12172b3264b2889f4583ee64752ce832e29bc8b1089dca81093459697165db' },
    { file: `scrcpy-win32-v${VERSION}.zip`, arch: 'ia32', sha256: 'fa57b36622a53b6aec74c5e5b5c08236165efa445c4f186d48f176ebf9c24eec' }
  ],
  linux: [
    { file: `scrcpy-linux-x86_64-v${VERSION}.tar.gz`, arch: 'x64', sha256: 'ad56ae8bfeedf41e824945c11dbf55fcb092b3e615b9b486f48a50e30d389635' }
  ]
}

const selected = artifacts[platform]
if (!selected) throw new Error(`Bundled scrcpy is not configured for ${platform}.`)

await mkdir(join(projectRoot, 'vendor'), { recursive: true })

for (const artifact of selected) {
  const destination = join(projectRoot, 'vendor', `scrcpy-${artifact.arch}`)
  const marker = join(destination, '.scrcpy-bundle')
  try {
    const [markerText, licenseText] = await Promise.all([
      readFile(marker, 'utf8'),
      readFile(join(destination, licenseName), 'utf8')
    ])
    if (markerText.trim() === `${VERSION} ${artifact.sha256}` && /Apache License\s+Version 2\.0/s.test(licenseText)) {
      console.log(`scrcpy ${VERSION} ${artifact.arch} is ready.`)
      continue
    }
  } catch {
    // The bundle has not been prepared yet.
  }

  const response = await fetch(`${RELEASE_BASE}/${artifact.file}`)
  if (!response.ok) throw new Error(`Failed to download ${artifact.file}: HTTP ${response.status}`)
  const archive = Buffer.from(await response.arrayBuffer())
  const actualHash = createHash('sha256').update(archive).digest('hex')
  if (actualHash !== artifact.sha256) throw new Error(`Checksum mismatch for ${artifact.file}.`)

  const temporary = await mkdtemp(join(tmpdir(), 'scrcpy-gui-bundle-'))
  const extracted = join(temporary, 'extracted')
  await mkdir(extracted)
  const result = process.platform === 'win32' && artifact.file.endsWith('.zip')
    ? spawnSync('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', join(projectRoot, 'scripts', 'extract-verified-zip.ps1'),
        '-Destination', extracted,
        '-ExpectedRoot', artifact.file.slice(0, -'.zip'.length)
      ], { input: archive, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true })
    : spawnSync('tar', [artifact.file.endsWith('.tar.gz') ? '-xzf' : '-xf', '-', '-C', extracted, '--strip-components=1'], {
        input: archive,
        stdio: ['pipe', 'inherit', 'inherit']
      })
  if (result.status !== 0) throw new Error(`Could not extract ${artifact.file}.`)

  const licenseText = await readFile(join(extracted, licenseName), 'utf8')
  if (!/Apache License\s+Version 2\.0/s.test(licenseText)) {
    throw new Error(`The verified ${artifact.file} archive does not contain the expected scrcpy Apache-2.0 license.`)
  }

  await writeFile(join(extracted, '.scrcpy-bundle'), `${VERSION} ${artifact.sha256}\n`)
  await rm(destination, { recursive: true, force: true })
  await cp(extracted, destination, { recursive: true })
  await rm(temporary, { recursive: true, force: true })
  console.log(`Prepared verified scrcpy ${VERSION} bundle for ${artifact.arch}.`)
}
