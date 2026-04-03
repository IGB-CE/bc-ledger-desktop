const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ledgerApp", {
  runReport: (options) => ipcRenderer.invoke("ledger:run-report", options),
  saveExport: (payload) => ipcRenderer.invoke("ledger:save-export", payload),
});
