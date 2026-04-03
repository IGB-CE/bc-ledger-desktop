const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ledgerApp", {
  runReport: (options) => ipcRenderer.invoke("ledger:run-report", options),
  runReports: (options) => ipcRenderer.invoke("ledger:run-reports", options),
  saveExport: (payload) => ipcRenderer.invoke("ledger:save-export", payload),
});
