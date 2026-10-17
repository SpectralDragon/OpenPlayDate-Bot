const { contextBridge, ipcRenderer } = require('electron');
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args).then(result => { if (!result.ok) throw new Error(result.error); return result.value; });
const listen = (channel, callback) => { const listener = (_, value) => callback(value); ipcRenderer.on(channel, listener); return () => ipcRenderer.removeListener(channel, listener); };
contextBridge.exposeInMainWorld('studio', {
  initial: () => invoke('project:initial'), open: () => invoke('project:open'), create: template => invoke('project:new', template),
  read: file => invoke('file:read', file), save: (file, text, expected) => invoke('file:save', file, text, expected), newFile: file => invoke('file:create', file),
  export: () => invoke('project:export'), run: () => invoke('sim:run'), control: action => invoke('sim:control', action), input: mask => invoke('sim:input', mask),
  discover: () => invoke('device:discover'), connect: address => invoke('device:connect', address), deploy: () => invoke('device:deploy'),
  onDeployProgress: callback => listen('device:progress', callback),
  gpio: (pin, level) => invoke('sim:gpio', pin, level), uart: text => invoke('sim:uart', text), api: () => invoke('help:api'), portal: () => invoke('help:portal'),
  screenshot: data => invoke('screen:save', data), close: () => invoke('window:close'),
  onFrame: callback => listen('sim:frame', callback), onEvent: callback => listen('sim:event', callback), onClosing: callback => listen('window:closing', callback)
});
