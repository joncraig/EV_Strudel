import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { PatchMeta, PatchSummary } from '../shared/patch'
import type { CatalogItem, Collection } from '../shared/catalog'
import type { DownloadProgress, PackSounds, PackStatus } from '../shared/samplePacks'

// Custom APIs for renderer
const api = {
  library: {
    list: (): Promise<PatchSummary[]> => ipcRenderer.invoke('library:list'),
    read: (file: string): Promise<{ meta: PatchMeta; code: string }> =>
      ipcRenderer.invoke('library:read', file),
    save: (file: string | null, meta: PatchMeta, code: string): Promise<string> =>
      ipcRenderer.invoke('library:save', file, meta, code),
    remove: (file: string): Promise<void> => ipcRenderer.invoke('library:delete', file),
    import: (input: string): Promise<string[]> => ipcRenderer.invoke('library:import', input),
    openFolder: (): Promise<string> => ipcRenderer.invoke('library:open-folder')
  },
  samples: {
    list: (): Promise<PackStatus[]> => ipcRenderer.invoke('samples:list'),
    loadUrl: (id: string): Promise<string> => ipcRenderer.invoke('samples:load-url', id),
    sounds: (id: string): Promise<PackSounds> => ipcRenderer.invoke('samples:sounds', id),
    download: (id: string): Promise<DownloadProgress> => ipcRenderer.invoke('samples:download', id),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('samples:remove', id),
    onProgress: (cb: (p: DownloadProgress) => void): (() => void) => {
      const listener = (_: unknown, p: DownloadProgress): void => cb(p)
      ipcRenderer.on('samples:progress', listener)
      return () => ipcRenderer.removeListener('samples:progress', listener)
    }
  },
  catalog: {
    list: (): Promise<Collection[]> => ipcRenderer.invoke('catalog:list'),
    browse: (id: string): Promise<CatalogItem[]> => ipcRenderer.invoke('catalog:browse', id),
    preview: (url: string): Promise<{ meta: PatchMeta; code: string }> =>
      ipcRenderer.invoke('catalog:preview', url)
  }
}

export type Api = typeof api

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
