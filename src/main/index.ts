import { app, shell, BrowserWindow, powerMonitor } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerLibraryIpc } from './library'
import { registerSampleScheme, registerSamplesIpc } from './samples'
import { loadWindowState, trackWindowState } from './windowState'
import { installMenu } from './menu'

// Dev only: Chrome DevTools Protocol endpoint so tooling can read the renderer's console
// and inspect state. Port is allocated in the compendium port map (9223/9224 are taken).
if (!app.isPackaged) app.commandLine.appendSwitch('remote-debugging-port', '9225')

registerSampleScheme()

function createWindow(): void {
  const windowState = loadWindowState()
  const mainWindow = new BrowserWindow({
    ...windowState.bounds,
    minWidth: 800,
    minHeight: 500,
    show: false,
    autoHideMenuBar: false,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  trackWindowState(mainWindow, windowState)
  installMenu(mainWindow, is.dev)

  // Dev only: after sleep, Vite's client can reload the page while Windows still has
  // networking suspended (net::ERR_NETWORK_IO_SUSPENDED), leaving a blank window.
  // On wake, reload once the network is back, but only if the app never mounted.
  if (is.dev) {
    powerMonitor.on('resume', () => {
      setTimeout(async () => {
        if (mainWindow.isDestroyed()) return
        const blank = await mainWindow.webContents
          .executeJavaScript("!document.getElementById('root')?.children.length")
          .catch(() => true)
        if (blank) mainWindow.webContents.reload()
      }, 3000)
    })
  }

  mainWindow.on('ready-to-show', () => {
    if (windowState.isMaximized) mainWindow.maximize()
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerLibraryIpc()
  registerSamplesIpc()

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
