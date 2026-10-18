// A patch is a plain-text Strudel file. Metadata lives in leading `// @key value`
// comment lines, so the file stays runnable as-is.

export interface PatchMeta {
  title: string
  source?: string
  tags: string[]
}

export interface PatchSummary extends PatchMeta {
  file: string
  modified: number
  preview: string
}

const META_LINE = /^\/\/\s*@(\w+)\s+(.*)$/

export function parsePatch(text: string): { meta: Partial<PatchMeta>; code: string } {
  const lines = text.split(/\r?\n/)
  const meta: Partial<PatchMeta> = {}
  let i = 0
  for (; i < lines.length; i++) {
    const m = lines[i].match(META_LINE)
    if (!m) break
    const [, key, value] = m
    if (key === 'title') meta.title = value.trim()
    else if (key === 'source') meta.source = value.trim()
    else if (key === 'tags')
      meta.tags = value
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
  }
  return { meta, code: lines.slice(i).join('\n').replace(/^\n+/, '') }
}

export function serializePatch(meta: PatchMeta, code: string): string {
  const head = [`// @title ${meta.title}`]
  if (meta.source) head.push(`// @source ${meta.source}`)
  if (meta.tags.length) head.push(`// @tags ${meta.tags.join(', ')}`)
  return `${head.join('\n')}\n\n${code.trimEnd()}\n`
}
