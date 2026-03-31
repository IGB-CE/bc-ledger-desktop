const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ledgerApp", {
  runReport: (options) => ipcRenderer.invoke("ledger:run-report", options),
});
