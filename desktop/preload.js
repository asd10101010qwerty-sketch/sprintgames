// Мост между игрой и программой: window.SprintApp (такой же, как в Android-приложении).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('SprintApp', {
  platform: 'windows',
  getLocalIps: () => ipcRenderer.sendSync('sg:ips'),
  findServer: () => ipcRenderer.invoke('sg:findServer'),
  isHost: () => ipcRenderer.sendSync('sg:isHost'),
  vibrate: () => {},
  update: () => ipcRenderer.invoke('sg:update'),
  version: () => '1'
});
