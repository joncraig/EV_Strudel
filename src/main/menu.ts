import { BrowserWindow, Menu, MenuItemConstructorOptions } from 'electron'

// Standard File / Edit / View menu. Items send a command to the renderer, which owns
// the patch and canvas state. Shortcuts are shown but not registered here
// (registerAccelerator: false): the renderer handles the keys itself, so Ctrl+Z
// in a text field still undoes the text rather than the canvas.

import type { MenuCommand } from '../shared/menu'

export function installMenu(win: BrowserWindow, dev: boolean): void {
  const send = (command: MenuCommand) => (): void => {
    if (!win.isDestroyed()) win.webContents.send('menu:command', command)
  }
  const item = (label: string, command: MenuCommand, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    click: send(command),
    accelerator,
    registerAccelerator: false
  })

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        item('New', 'new'),
        item('Open…', 'open'),
        { type: 'separator' },
        item('Save', 'save', 'CmdOrCtrl+S'),
        item('Save As New Patch', 'saveAs'),
        { type: 'separator' },
        item('Show Library Folder', 'showFolder'),
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [item('Undo', 'undo', 'CmdOrCtrl+Z'), item('Redo', 'redo', 'CmdOrCtrl+Shift+Z')]
    },
    {
      label: 'View',
      submenu: [
        item('Show Code', 'toggleCode'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(dev ? ([{ role: 'reload' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[]) : [])
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
