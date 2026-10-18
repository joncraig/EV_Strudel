import { ipcMain, net, protocol, WebContents } from 'electron'
import { promises as fs } from 'fs'
import { dirname, join, normalize, sep } from 'path'
import { pathToFileURL } from 'url'
import { libraryDir } from './library'
import { DownloadProgress, PackStatus, SAMPLE_PACKS, countSounds } from '../shared/samplePacks'

// Downloaded packs live in <library>/samples/<pack id>/ and are served to the
// renderer as evsamples://pack/<pack id>/..., so Strudel loads them like any URL.
const SCHEME = 'evsamples'

const samplesDir = (): string => join(libraryDir(), 'samples')
const packDir = (id: string): string => join(samplesDir(), id.replace(/[^\w-]/g, '_'))
const localMapPath = (id: string): string => join(packDir(id), 'strudel.json')
const localBase = (id: string): string => `${SCHEME}://pack/${encodeURIComponent(id)}/`

// Must run before app 'ready'.
export function registerSampleScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
    }
  ])
}

function serveSamples(): void {
  protocol.handle(SCHEME, (req) => {
    const url = new URL(req.url)
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^[\\/]+/, '')
    const full = join(samplesDir(), rel)
    if (!full.startsWith(samplesDir() + sep)) return new Response('Forbidden', { status: 403 })
    return net.fetch(pathToFileURL(full).toString())
  })
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

const mapCache = new Map<string, Promise<Record<string, unknown>>>()

function remoteMap(url: string): Promise<Record<string, unknown>> {
  let p = mapCache.get(url)
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText} fetching ${url}`)
      return r.json()
    })
    mapCache.set(url, p)
    p.catch(() => mapCache.delete(url))
  }
  return p
}

function findPack(id: string): (typeof SAMPLE_PACKS)[number] {
  const pack = SAMPLE_PACKS.find((p) => p.id === id)
  if (!pack) throw new Error(`Unknown sample pack ${id}`)
  return pack
}

async function list(): Promise<PackStatus[]> {
  return Promise.all(SAMPLE_PACKS.map(async (p) => ({ ...p, downloaded: await exists(localMapPath(p.id)) })))
}

// The URL Strudel should load: the local copy if downloaded, else the remote map.
async function loadUrl(id: string): Promise<string> {
  const pack = findPack(id)
  return (await exists(localMapPath(id))) ? `${localBase(id)}strudel.json` : pack.url
}

async function sounds(id: string): Promise<Record<string, number>> {
  const pack = findPack(id)
  const map = (await exists(localMapPath(id)))
    ? JSON.parse(await fs.readFile(localMapPath(id), 'utf8'))
    : await remoteMap(pack.url)
  return countSounds(map)
}

// Turn a remote file reference into a safe relative path inside the pack folder.
function localRel(fileUrl: URL): string {
  const parts = [fileUrl.hostname, ...fileUrl.pathname.split('/')]
    .filter(Boolean)
    .map((s) => decodeURIComponent(s).replace(/[<>:"|?*\\]/g, '_'))
    .filter((s) => s !== '.' && s !== '..')
  return parts.join('/')
}

// One download per pack at a time; a second request joins the first.
const downloading = new Map<string, Promise<DownloadProgress>>()

function download(id: string, sender: WebContents): Promise<DownloadProgress> {
  let p = downloading.get(id)
  if (!p) {
    p = downloadPack(id, sender).finally(() => downloading.delete(id))
    downloading.set(id, p)
  }
  return p
}

async function downloadPack(id: string, sender: WebContents): Promise<DownloadProgress> {
  if (await exists(localMapPath(id))) return { id, done: 0, total: 0, failed: 0 }
  {
    const pack = findPack(id)
    const map = await remoteMap(pack.url)
    const base = new URL(typeof map._base === 'string' ? map._base : '.', pack.url)

    // Rewrite every file string to a local path, remembering what to fetch.
    const jobs = new Map<string, string>() // local rel path -> remote url
    const rewrite = (value: unknown): unknown => {
      if (typeof value === 'string') {
        const remote = new URL(value, base)
        const rel = localRel(remote)
        jobs.set(rel, remote.href)
        return rel
      }
      if (Array.isArray(value)) return value.map(rewrite)
      if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v)]))
      return value
    }
    const localMap: Record<string, unknown> = { _base: localBase(id) }
    for (const [key, value] of Object.entries(map)) if (!key.startsWith('_')) localMap[key] = rewrite(value)

    const progress: DownloadProgress = { id, done: 0, total: jobs.size, failed: 0 }
    const report = (): void => {
      if (!sender.isDestroyed()) sender.send('samples:progress', { ...progress })
    }
    report()

    const queue = [...jobs.entries()]
    const worker = async (): Promise<void> => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const [rel, url] = job
        const dest = join(packDir(id), ...rel.split('/'))
        try {
          if (!(await exists(dest))) {
            const res = await fetch(url)
            if (!res.ok) throw new Error(String(res.status))
            await fs.mkdir(dirname(dest), { recursive: true })
            await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()))
          }
        } catch {
          progress.failed++
        }
        progress.done++
        if (progress.done % 10 === 0 || progress.done === progress.total) report()
      }
    }
    await Promise.all(Array.from({ length: 8 }, worker))

    // Write the map last: its presence means "downloaded".
    await fs.writeFile(localMapPath(id), JSON.stringify(localMap, null, 1), 'utf8')
    report()
    return progress
  }
}

async function remove(id: string): Promise<void> {
  findPack(id)
  await fs.rm(packDir(id), { recursive: true, force: true })
}

export function registerSamplesIpc(): void {
  serveSamples()
  ipcMain.handle('samples:list', () => list())
  ipcMain.handle('samples:load-url', (_, id: string) => loadUrl(id))
  ipcMain.handle('samples:sounds', (_, id: string) => sounds(id))
  ipcMain.handle('samples:download', (e, id: string) => download(id, e.sender))
  ipcMain.handle('samples:remove', (_, id: string) => remove(id))
}
