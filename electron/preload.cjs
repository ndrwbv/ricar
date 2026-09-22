const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('knightFS', {
  listLevels: () => ipcRenderer.invoke('levels:list'),
  loadLevel: id => ipcRenderer.invoke('levels:load', id),
  saveLevel: (id, json) => ipcRenderer.invoke('levels:save', id, json),
  deleteLevel: id => ipcRenderer.invoke('levels:delete', id),
});
