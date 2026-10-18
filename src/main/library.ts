import { app, ipcMain, shell } from 'electron'
import { promises as fs } from 'fs'
import { join, basename } from 'path'
import { parsePatch, serializePatch, PatchMeta, PatchSummary } from '../shared/patch'
import { CATALOG, CatalogItem, Collection, STRUDEL_TUNES_URL, parseTunes } from '../shared/catalog'

const EXT = '.strudel'

export function libraryDir(): string {
  return join(app.getPath('documents'), 'EV_Strudel Library')
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'untitled'
  )
}

// Only allow plain filenames inside the library folder.
function safePath(file: string): string {
  const name = basename(file)
  if (name !== file || !name.endsWith(EXT)) throw new Error(`Bad patch filename: ${file}`)
  return join(libraryDir(), name)
}

async function uniqueFile(title: string): Promise<string> {
  const base = slugify(title)
  for (let n = 1; ; n++) {
    const file = `${base}${n > 1 ? `-${n}` : ''}${EXT}`
    try {
      await fs.access(join(libraryDir(), file))
    } catch {
      return file
    }
  }
}

async function list(): Promise<PatchSummary[]> {
  await fs.mkdir(libraryDir(), { recursive: true })
  const files = (await fs.readdir(libraryDir())).filter((f) => f.endsWith(EXT))
  const out = await Promise.all(
    files.map(async (file) => {
      const full = join(libraryDir(), file)
      const [text, stat] = await Promise.all([fs.readFile(full, 'utf8'), fs.stat(full)])
      const { meta, code } = parsePatch(text)
      return {
        file,
        title: meta.title ?? file.slice(0, -EXT.length),
        source: meta.source,
        tags: meta.tags ?? [],
        modified: stat.mtimeMs,
        preview: code.slice(0, 400)
      }
    })
  )
  return out.sort((a, b) => b.modified - a.modified)
}

async function read(file: string): Promise<{ meta: PatchMeta; code: string }> {
  const { meta, code } = parsePatch(await fs.readFile(safePath(file), 'utf8'))
  return { meta: { title: meta.title ?? file, source: meta.source, tags: meta.tags ?? [] }, code }
}

// Writes to `file` if given, otherwise creates a new file from the title.
async function save(file: string | null, meta: PatchMeta, code: string): Promise<string> {
  await fs.mkdir(libraryDir(), { recursive: true })
  const target = file ?? (await uniqueFile(meta.title))
  await fs.writeFile(safePath(target), serializePatch(meta, code), 'utf8')
  return target
}

// ---- Importing from wherever patches live ----
// Fetching happens here in the main process, so CORS doesn't apply.

interface Fetched {
  title: string
  code: string
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': 'EV_Strudel' } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${url}`)
  return res.text()
}

function titleFromPath(path: string): string {
  return decodeURIComponent(basename(path)).replace(/\.[^.]+$/, '') || 'Imported patch'
}

async function resolve(input: string): Promise<Fetched[]> {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    // Not a URL: treat pasted text as code.
    return [{ title: 'Pasted patch', code: input }]
  }

  // One tune out of the official tunes file: <tunes url>#<name>.
  if (url.href.split('#')[0] === STRUDEL_TUNES_URL && url.hash.length > 1) {
    const name = url.hash.slice(1)
    const code = (await officialTunes())[name]
    if (code === undefined) throw new Error(`No tune named "${name}" in the Strudel examples.`)
    return [{ title: name, code }]
  }

  // strudel.cc share link: the code is base64 in the hash.
  if (url.hostname.endsWith('strudel.cc')) {
    if (url.hash.length > 1) {
      const code = Buffer.from(decodeURIComponent(url.hash.slice(1)), 'base64').toString('utf8')
      return [{ title: 'strudel.cc patch', code }]
    }
    throw new Error(
      'Short strudel.cc links are stored on their server. Open it on strudel.cc, then copy the long share URL or the code.'
    )
  }

  // GitHub gist: every file becomes a patch.
  if (url.hostname === 'gist.github.com') {
    const id = url.pathname.split('/').filter(Boolean).pop()
    const gist = JSON.parse(await fetchText(`https://api.github.com/gists/${id}`))
    const files = Object.values(gist.files as Record<string, { filename: string; content: string }>)
    return files.map((f) => ({ title: f.filename.replace(/\.[^.]+$/, ''), code: f.content }))
  }

  // GitHub file page: fetch the raw file instead.
  if (url.hostname === 'github.com' && url.pathname.includes('/blob/')) {
    const raw = `https://raw.githubusercontent.com${url.pathname.replace('/blob/', '/')}`
    return [{ title: titleFromPath(url.pathname), code: await fetchText(raw) }]
  }

  const body = await fetchText(url.href)
  if (/^\s*<(!doctype|html)/i.test(body))
    throw new Error('That URL is a web page, not a patch file. Link to the raw code instead.')
  return [{ title: titleFromPath(url.pathname), code: body }]
}

// ---- Browsing the catalog ----
// Cached for the session: unauthenticated GitHub API allows 60 requests an hour.

let tunesCache: Promise<Record<string, string>> | null = null
function officialTunes(): Promise<Record<string, string>> {
  tunesCache ??= fetchText(STRUDEL_TUNES_URL).then(parseTunes)
  tunesCache.catch(() => (tunesCache = null))
  return tunesCache
}

const browseCache = new Map<string, Promise<CatalogItem[]>>()

async function listCollection(c: Collection): Promise<CatalogItem[]> {
  if (c.kind === 'strudel-tunes') {
    return Object.keys(await officialTunes()).map((name) => ({ title: name, url: `${c.url}#${name}` }))
  }
  const tree = JSON.parse(
    await fetchText(`https://api.github.com/repos/${c.repo}/git/trees/HEAD?recursive=1`)
  ) as { tree: { path: string; type: string }[] }
  return tree.tree
    .filter((e) => e.type === 'blob' && e.path.endsWith(EXT))
    .map((e) => ({
      title: e.path.replace(/\.strudel$/, ''),
      url: `https://raw.githubusercontent.com/${c.repo}/HEAD/${e.path.split('/').map(encodeURIComponent).join('/')}`
    }))
    .sort((a, b) => a.title.localeCompare(b.title))
}

function browse(id: string): Promise<CatalogItem[]> {
  const c = CATALOG.find((x) => x.id === id)
  if (!c) throw new Error(`Unknown collection ${id}`)
  let p = browseCache.get(id)
  if (!p) {
    p = listCollection(c)
    browseCache.set(id, p)
    p.catch(() => browseCache.delete(id))
  }
  return p
}

// Fetch without saving, so a patch can be auditioned first.
async function preview(input: string): Promise<{ meta: PatchMeta; code: string }> {
  const [f] = await resolve(input.trim())
  const { meta, code } = parsePatch(f.code)
  return {
    meta: { title: meta.title ?? f.title, source: meta.source ?? input.trim(), tags: meta.tags ?? [] },
    code
  }
}

async function importPatches(raw: string): Promise<string[]> {
  const input = raw.trim()
  const isUrl = /^https?:\/\//i.test(input)
  const saved: string[] = []
  for (const f of await resolve(input)) {
    const { meta, code } = parsePatch(f.code)
    const patchMeta: PatchMeta = {
      title: meta.title ?? f.title,
      source: meta.source ?? (isUrl ? input : undefined),
      tags: meta.tags ?? []
    }
    saved.push(await save(null, patchMeta, code))
  }
  return saved
}

export function registerLibraryIpc(): void {
  ipcMain.handle('library:list', () => list())
  ipcMain.handle('library:read', (_, file: string) => read(file))
  ipcMain.handle('library:save', (_, file: string | null, meta: PatchMeta, code: string) =>
    save(file, meta, code)
  )
  ipcMain.handle('library:delete', (_, file: string) => shell.trashItem(safePath(file)))
  ipcMain.handle('library:import', (_, input: string) => importPatches(input))
  ipcMain.handle('catalog:list', () => CATALOG)
  ipcMain.handle('catalog:browse', (_, id: string) => browse(id))
  ipcMain.handle('catalog:preview', (_, url: string) => preview(url))
  ipcMain.handle('library:open-folder', async () => {
    await fs.mkdir(libraryDir(), { recursive: true })
    return shell.openPath(libraryDir())
  })
}
