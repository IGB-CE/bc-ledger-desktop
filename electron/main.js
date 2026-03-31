const path = require("path");
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const { buildLedgerReport } = require("../src/ledger-service");
const { config } = require("../src/config");

function createWindow() {
  const { workAreaSize } = screen.getPrimaryDisplay();
  const width = Math.min(1440, Math.floor(workAreaSize.width * 0.96));

  const mainWindow = new BrowserWindow({
    width,
    height: 860,
    minWidth: 980,
    minHeight: 720,
    backgroundColor: "#f3efe7",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

app.whenReady().then(() => {
  ipcMain.handle("ledger:get-defaults", async () => ({
    accountNo: config.accountNo,
  }));

  ipcMain.handle("ledger:run-report", async (_event, options) => {
    try {
      const report = await buildLedgerReport(options || {});
      return { ok: true, report };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
