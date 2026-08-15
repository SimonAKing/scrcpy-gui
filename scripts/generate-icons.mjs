import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = join(projectRoot, 'build', 'icon.svg')
const outputDirectory = join(projectRoot, 'build', 'icons')
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const checkOnly = process.argv.includes('--check')

function render(svg, size) {
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng())
}

function createIco(images) {
  const headerSize = 6 + images.length * 16
  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = headerSize
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16
    header.writeUInt8(size >= 256 ? 0 : size, entry)
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1)
    header.writeUInt8(0, entry + 2)
    header.writeUInt8(0, entry + 3)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...images.map(({ png }) => png)])
}

function createIcns(images) {
  const chunkTypes = new Map([
    [16, 'icp4'],
    [32, 'icp5'],
    [64, 'icp6'],
    [128, 'ic07'],
    [256, 'ic08'],
    [512, 'ic09'],
    [1024, 'ic10']
  ])
  const chunks = images
    .filter(({ size }) => chunkTypes.has(size))
    .map(({ size, png }) => {
      const chunk = Buffer.alloc(8 + png.length)
      chunk.write(chunkTypes.get(size), 0, 4, 'ascii')
      chunk.writeUInt32BE(chunk.length, 4)
      png.copy(chunk, 8)
      return chunk
    })
  const header = Buffer.alloc(8)
  header.write('icns', 0, 4, 'ascii')
  header.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4)
  return Buffer.concat([header, ...chunks])
}

const svg = await readFile(sourcePath)
const images = sizes.map((size) => ({ size, png: render(svg, size) }))
const outputs = [
  ...images.map(({ size, png }) => ({ path: join(outputDirectory, `${size}x${size}.png`), contents: png })),
  { path: join(outputDirectory, 'icon.ico'), contents: createIco(images.filter(({ size }) => size <= 256)) },
  { path: join(outputDirectory, 'icon.icns'), contents: createIcns(images) }
]

if (checkOnly) {
  const stale = []
  for (const output of outputs) {
    try {
      if (!(await readFile(output.path)).equals(output.contents)) stale.push(output.path)
    } catch {
      stale.push(output.path)
    }
  }
  if (stale.length) throw new Error(`Generated icon assets are stale:\n${stale.join('\n')}`)
  console.log(`Verified ${outputs.length} generated icon assets.`)
} else {
  await mkdir(outputDirectory, { recursive: true })
  await Promise.all(outputs.map((output) => writeFile(output.path, output.contents)))
  console.log(`Generated ${images.length} PNG sizes plus ICO and ICNS from ${sourcePath}.`)
}
