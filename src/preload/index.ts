import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { PatchMeta, PatchSummary } from '../shared/patch'

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
