'use strict';
// The only bridge between the page and the main process. The page gets no Node.js or file system access:
// it can read the files the user chose (by id), ask for the open dialogs, and save a file through a Save dialog.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sliceviewDesktop', {
  isDesktop: true,
  info: () => ipcRenderer.invoke('sv:info'),
  ready: () => ipcRenderer.send('sv:ready'),
  readFile: id => ipcRenderer.invoke('sv:read-file', id),
  release: ids => ipcRenderer.invoke('sv:release', ids),
  openDialog: kind => ipcRenderer.invoke('sv:open-dialog', kind),
  saveFile: (filename, data) => ipcRenderer.invoke('sv:save-file', { filename, data }),
  showInFolder: p => ipcRenderer.invoke('sv:show-in-folder', p),
  onOpenFiles: cb => ipcRenderer.on('sv:open-files', (e, m) => cb(m)),
  onClick: cb => ipcRenderer.on('sv:click', (e, sel) => cb(sel)),
  onMessage: cb => ipcRenderer.on('sv:message', (e, m) => cb(m)),
});
