const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('db:load'),
  save: (data) => ipcRenderer.invoke('db:save', data),
  savePart: (payload) => ipcRenderer.invoke('db:savePart', payload),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  copyImage: (dataUrl) => ipcRenderer.invoke('clipboard:image', dataUrl),
  licenseStatus: () => ipcRenderer.invoke('license:status'),
  licenseActivate: (key) => ipcRenderer.invoke('license:activate', key),
  prepareShare: (photos) => ipcRenderer.invoke('share:prepare', photos),
  startDrag: (idx) => ipcRenderer.send('share:startDrag', idx),
  print: (pageSize) => ipcRenderer.invoke('print', pageSize),
  saveXlsx: (bytes, name) => ipcRenderer.invoke('export:xlsx', bytes, name),
  exportPdf: (html, name) => ipcRenderer.invoke('export:pdf', html, name),
  exportBackup: (json) => ipcRenderer.invoke('backup:export', json),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  backupGetConfig: () => ipcRenderer.invoke('backup:config:get'),
  backupSetConfig: (patch) => ipcRenderer.invoke('backup:config:set', patch),
  backupChooseDir: () => ipcRenderer.invoke('backup:chooseDir'),
  backupList: () => ipcRenderer.invoke('backup:list'),
  backupRestore: (name) => ipcRenderer.invoke('backup:restore', name),
  backupOpenDir: () => ipcRenderer.invoke('backup:openDir')
});
