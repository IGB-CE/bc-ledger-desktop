const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ledgerApp", {
  getDefaults: () => ipcRenderer.invoke("ledger:get-defaults"),
  runReport: (options) => ipcRenderer.invoke("ledger:run-report", options),
});
