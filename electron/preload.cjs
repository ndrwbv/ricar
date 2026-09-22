const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('knightFS', {
  listLevels: () => ipcRenderer.invoke('levels:list'),
  loadLevel: id => ipcRenderer.invoke('levels:load', id),
  saveLevel: (id, json) => ipcRenderer.invoke('levels:save', id, json),
  deleteLevel: id => ipcRenderer.invoke('levels:delete', id),
});
// обновление игры с GitHub (только для сборки, поставленной install-deck.sh)
contextBridge.exposeInMainWorld('knightUpdate', {
  info: () => ipcRenderer.invoke('update:info'),
  check: manual => ipcRenderer.invoke('update:check', manual),
  apply: () => ipcRenderer.invoke('update:apply'),
});
