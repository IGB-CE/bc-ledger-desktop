const path = require("path");
const fs = require("fs/promises");
const { app, BrowserWindow, dialog, ipcMain, screen } = require("electron");
const { buildLedgerReport, buildLedgerReports } = require("../src/ledger-service");
const activeSearchControllers = new Map();

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
  ipcMain.handle("ledger:run-report", async (_event, options) => {
    try {
      const report = await buildLedgerReport(options || {});
      return { ok: true, report };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("ledger:run-reports", async (_event, options) => {
    const requestId = String(options?.requestId || "").trim();
    const controller = new AbortController();

    if (requestId) {
      activeSearchControllers.set(requestId, controller);
    }

    try {
      const reports = await buildLedgerReports({
        ...(options || {}),
        signal: controller.signal,
      });
      return { ok: true, reports };
    } catch (error) {
      if (error?.code === "SEARCH_CANCELED") {
        return { ok: false, canceled: true, error: error.message };
      }

      return { ok: false, error: error.message };
    } finally {
      if (requestId) {
        activeSearchControllers.delete(requestId);
      }
    }
  });

  ipcMain.handle("ledger:cancel-search", async (_event, payload) => {
    const requestId = String(payload?.requestId || "").trim();

    if (!requestId) {
      return { ok: false, error: "Missing requestId." };
    }

    const controller = activeSearchControllers.get(requestId);

    if (!controller) {
      return { ok: false, error: "Search is no longer active." };
    }

    controller.abort();
    return { ok: true, canceled: true };
  });

  ipcMain.handle("ledger:save-export", async (_event, payload) => {
    try {
      const suggestedName = String(payload?.suggestedName || "ledger-export.xlsx").trim() || "ledger-export.xlsx";
      const content = String(payload?.content || "");
      const contentBase64 = String(payload?.contentBase64 || "");
      const result = await dialog.showSaveDialog({
        title: "Save Excel Export",
        defaultPath: suggestedName,
        filters: [
          { name: "Excel Workbook", extensions: ["xlsx"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { ok: false, canceled: true };
      }

      if (contentBase64) {
        await fs.writeFile(result.filePath, Buffer.from(contentBase64, "base64"));
      } else {
        await fs.writeFile(result.filePath, content, "utf8");
      }

      return { ok: true, filePath: result.filePath };
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
