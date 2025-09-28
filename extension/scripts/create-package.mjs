import { mkdir, copyFile, readFile, rm, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { execFile } from 'child_process'
import { promisify } from 'util'

const exec = promisify(execFile)

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = join(__dirname, '..')
const distDir = join(rootDir, 'dist')
const outDir = join(rootDir, 'out')

const PACKAGE_NAME = 'nebula-extension'

async function getGitInfo() {
  try {
    const { stdout: hash } = await exec('git', ['rev-parse', '--short', 'HEAD'], { cwd: rootDir })
    const { stdout: status } = await exec('git', ['status', '--short', '--untracked-files=no'], { cwd: rootDir })
    return {
      commit: hash.trim(),
      dirty: status.trim().length > 0
    }
  } catch {
    return { commit: 'unknown', dirty: false }
  }
}

async function readManifest(path) {
  const raw = await readFile(path, 'utf8')
  return JSON.parse(raw)
}

async function writeManifest(path, manifest) {
  const content = JSON.stringify(manifest, null, 2) + '\n'
  await writeFile(path, content, 'utf8')
}

async function generateMetadata(manifest) {
  const git = await getGitInfo()
  const buildMeta = {
    version: manifest.version,
    built_at: new Date().toISOString(),
    commit: git.commit,
    dirty: git.dirty
  }

  const metadataPath = join(distDir, 'BUILD_META.json')
  await writeFile(metadataPath, JSON.stringify(buildMeta, null, 2) + '\n', 'utf8')

  return buildMeta
}

async function prepareManifest(manifest) {
  const meta = await generateMetadata(manifest)
  const updated = {
    ...manifest,
    version_name: `${manifest.version} (${meta.commit}${meta.dirty ? '*' : ''})`,
    description: manifest.description
  }
  return updated
}

async function main() {
  const manifestPath = join(rootDir, 'manifest.json')
  const distManifestPath = join(distDir, 'manifest.json')

  const manifest = await readManifest(manifestPath)
  const updatedManifest = await prepareManifest(manifest)
  await writeManifest(distManifestPath, updatedManifest)

  await mkdir(outDir, { recursive: true })

  const zipName = `${PACKAGE_NAME}-v${manifest.version}.zip`
  const zipPath = join(outDir, zipName)

  await copyFile(join(distDir, 'manifest.json'), join(distDir, 'manifest.json.bak'))

  try {
    await exec('zip', ['-r', zipPath, '.'], { cwd: distDir })
    console.log(`Package created: ${zipPath}`)
  } finally {
    await copyFile(join(distDir, 'manifest.json.bak'), join(distDir, 'manifest.json'))
    await rm(join(distDir, 'manifest.json.bak'), { force: true })
  }
}

main().catch(error => {
  console.error('Failed to create package', error)
  process.exit(1)
})
