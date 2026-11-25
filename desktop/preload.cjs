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
  openBundle: () => ipcRenderer.invoke('project:openBundle'),
  openBundlePath: (root) => ipcRenderer.invoke('project:openBundlePath', root),
  saveBundle: (data) => ipcRenderer.invoke('project:saveBundle', data),
  saveBundleTo: (data, root) => ipcRenderer.invoke('project:saveBundleTo', data, root),
  relinkMedia: (assets) => ipcRenderer.invoke('project:relink', assets),
  queueList: () => ipcRenderer.invoke('queue:list'),
  queueAdd: (data, settings, outputPath) => ipcRenderer.invoke('queue:add', { data, settings, outputPath }),
  queueChooseOutput: (name) => ipcRenderer.invoke('queue:chooseOutput', name),
  queueClear: () => ipcRenderer.invoke('queue:clear'),
  queueRemove: (id) => ipcRenderer.invoke('queue:remove', id),
  saveProject: (data, options) => ipcRenderer.invoke('project:save', data, options),
  saveProjectTo: (data, file) => ipcRenderer.invoke('project:saveTo', data, file),
  autosave: (data) => ipcRenderer.invoke('project:autosave', data),
  extractAudio: (file) => ipcRenderer.invoke('audio:extract', file),
  transcode: (payload) => ipcRenderer.invoke('export:transcode', payload),
  title: (title) => ipcRenderer.invoke('window:title', title),
  showItem: (file) => ipcRenderer.invoke('shell:showItem', file),
  updateConfig: () => ipcRenderer.invoke('update:config'),
  setUpdateFeed: (feedUrl) => ipcRenderer.invoke('update:setFeed', feedUrl),
  checkUpdate: (feedUrl) => ipcRenderer.invoke('update:check', feedUrl),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  cancelUpdate: () => ipcRenderer.invoke('update:cancel'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
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
  onUpdateProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('update:progress', handler);
    return () => ipcRenderer.removeListener('update:progress', handler);
  },
  onQueueUpdate: (callback) => {
    const handler = (_event, jobs) => callback(jobs);
    ipcRenderer.on('queue:update', handler);
    return () => ipcRenderer.removeListener('queue:update', handler);
  },
  onUpdateAvailable: (callback) => {
    const handler = (_event, info) => callback(info);
    ipcRenderer.on('update:available', handler);
    return () => ipcRenderer.removeListener('update:available', handler);
  },
  automationJob: () => ipcRenderer.invoke('automation:job'),
  automationProgress: (progress) => ipcRenderer.send('automation:progress', progress),
  automationWrite: (buffer, filename) => ipcRenderer.invoke('automation:write', buffer, filename),
  automationDone: () => ipcRenderer.send('automation:done'),
  automationError: (message) => ipcRenderer.send('automation:error', message),
});