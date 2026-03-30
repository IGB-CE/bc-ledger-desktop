const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const TOOL_ROOT = path.resolve(__dirname, "..");
const GENERATED_CONFIG_PATH = path.join(__dirname, "generated-embedded-config.js");

function loadEnvIfPresent(envPath, override = false) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override, quiet: true });
  }
}

function loadEmbeddedConfig() {
  if (!fs.existsSync(GENERATED_CONFIG_PATH)) {
    return {};
  }

  // The generated file is local application code written by the build step.
  return require(GENERATED_CONFIG_PATH);
}

function getConfigValue(envName, embeddedValue, fallbackValue) {
  if (process.env[envName] !== undefined && process.env[envName] !== "") {
    return process.env[envName];
  }

  if (embeddedValue !== undefined && embeddedValue !== "") {
    return embeddedValue;
  }

  return fallbackValue;
}

loadEnvIfPresent(path.join(TOOL_ROOT, ".env"));

const embeddedConfig = loadEmbeddedConfig();
const config = {
  bcBaseUrl: getConfigValue(
    "BC_BASE_URL",
    embeddedConfig.bcBaseUrl,
    "https://onebs.onetech.al:9956/BC23_BS/ODataV4/Company('BESTSELLER')"
  ),
  bcUsername: getConfigValue("BC_USERNAME", embeddedConfig.bcUsername, ""),
  bcPassword: getConfigValue("BC_PASSWORD", embeddedConfig.bcPassword, ""),
  accountNo: getConfigValue("BC_LEDGER_ACCOUNT_NO", embeddedConfig.accountNo, "4092"),
  timeoutMs: Number(getConfigValue("BC_TIMEOUT_MS", embeddedConfig.timeoutMs, 45000)),
};

function assertConfig() {
  if (!config.bcUsername || !config.bcPassword) {
    throw new Error(
      "Missing BC credentials. Set BC_USERNAME and BC_PASSWORD in bc-ledger-desktop/.env or generate embedded config."
    );
  }
}

module.exports = {
  TOOL_ROOT,
  config,
  assertConfig,
};
