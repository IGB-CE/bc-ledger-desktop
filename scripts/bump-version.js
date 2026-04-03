const fs = require("fs");
const path = require("path");

const VERSION_PARTS = ["major", "minor", "patch"];
const requestedPart = String(process.argv[2] || "patch").toLowerCase();

if (!VERSION_PARTS.includes(requestedPart)) {
  throw new Error(`Unsupported version bump "${requestedPart}". Use one of: ${VERSION_PARTS.join(", ")}.`);
}

const packageJsonPath = path.join(__dirname, "..", "package.json");
const packageLockPath = path.join(__dirname, "..", "package-lock.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function bumpVersion(version, part) {
  const match = String(version || "").trim().match(/^(\d+)\.(\d+)\.(\d+)$/);

  if (!match) {
    throw new Error(`Version "${version}" is not a supported semver x.y.z value.`);
  }

  const next = {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };

  if (part === "major") {
    next.major += 1;
    next.minor = 0;
    next.patch = 0;
  } else if (part === "minor") {
    next.minor += 1;
    next.patch = 0;
  } else {
    next.patch += 1;
  }

  return `${next.major}.${next.minor}.${next.patch}`;
}

const packageJson = readJson(packageJsonPath);
const packageLock = readJson(packageLockPath);
const nextVersion = bumpVersion(packageJson.version, requestedPart);

packageJson.version = nextVersion;
packageLock.version = nextVersion;

if (packageLock.packages && packageLock.packages[""]) {
  packageLock.packages[""].version = nextVersion;
}

writeJson(packageJsonPath, packageJson);
writeJson(packageLockPath, packageLock);

process.stdout.write(`Version bumped to ${nextVersion}\n`);
