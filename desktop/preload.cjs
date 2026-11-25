const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('cutlineDesktop', {
  isDesktop: true,
  platform: process.platform,
  info: () => ipcRenderer.invoke('app:info'),
  startup: () => ipcRenderer.invoke('app:startup'),
  pickMedia: () => ipcRenderer.invoke('media:choose'),
  registerMedia: (paths) => ipcRenderer.invoke('media:register', paths),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  openProject: () => ipcRenderer.invoke('project:open'),
  newProject: () => ipcRenderer.invoke('project:new'),
  openProjectPath: (file) => ipcRenderer.invoke('project:openPath', file),
  saveProject: (data, options) => ipcRenderer.invoke('project:save', data, options),
  saveProjectTo: (data, file) => ipcRenderer.invoke('project:saveTo', data, file),
  autosave: (data) => ipcRenderer.invoke('project:autosave', data),
  extractAudio: (file) => ipcRenderer.invoke('audio:extract', file),
  transcode: (payload) => ipcRenderer.invoke('export:transcode', payload),
  title: (title) => ipcRenderer.invoke('window:title', title),
  showItem: (file) => ipcRenderer.invoke('shell:showItem', file),
  onMenuCommand: (callback) => {
    const handler = (_event, command) => callback(command);
    ipcRenderer.on('menu-command', handler);
    return () => ipcRenderer.removeListener('menu-command', handler);
  },
  onExportProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('export:progress', handler);
    return () => ipcRenderer.removeListener('export:progress', handler);
  },
});