#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const { execSync } = require("child_process");

const baseUrl =
  "https://raw.githubusercontent.com/update-1/Whatsapp-Goatbot/main";
const manifestUrl = `${baseUrl}/versions.json`;

const rootDir = __dirname;
const backupsDir = path.join(rootDir, "backups");
const packagePath = path.join(rootDir, "package.json");

function log(message) {
  console.log(`[updater] ${message}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchText(url) {
  const res = await axios.get(url, { timeout: 30000, responseType: "text" });
  return res.data;
}

function shouldSkip(fileContents) {
  const text = fileContents.split(/\r?\n/, 1)[0] || "";
  return /DO NOT UPDATE|SKIP UPDATE|DO NOT UPDATE THIS FILE/i.test(text);
}

async function mergeConfig(targetPath, remoteContent) {
  const targetExists = await fs.pathExists(targetPath);
  let localConfig = {};

  if (targetExists) {
    try {
      localConfig = await fs.readJson(targetPath);
    } catch {
      localConfig = {};
    }
  }

  const remoteConfig = JSON.parse(remoteContent);
  const merged = { ...remoteConfig, ...localConfig };

  await fs.ensureDir(path.dirname(targetPath));
  await fs.writeJson(targetPath, merged, { spaces: 2 });
}

/** Normalize line endings so \r\n and \n compare equal. */
function normalizeNewlines(str) {
  return String(str).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Compare two semver strings. Returns 1, -1, or 0. */
function compareVersion(v1, v2) {
  const a = String(v1).split(".").map(Number);
  const b = String(v2).split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) > (b[i] || 0)) return 1;
    if ((a[i] || 0) < (b[i] || 0)) return -1;
  }
  return 0;
}

/**
 * Backup a file into ONE shared folder: backups/backup_<currentVersion>/
 * Matches GoatBot-V2's approach — single folder per update run, full path preserved.
 */
async function backupFile(relativePath, folderBackup) {
  const localPath = path.join(rootDir, relativePath);
  if (!(await fs.pathExists(localPath))) return;
  const dest = path.join(folderBackup, relativePath);
  await fs.ensureDir(path.dirname(dest));
  await fs.copy(localPath, dest);
}

async function applyUpdates(manifest) {
  const currentVersion = require(packagePath).version;
  log(`Current version: v${currentVersion}`);

  // FIX: use compareVersion so v1.1.4 > v1.1.3 is detected correctly
  const pending = manifest.filter(entry =>
    compareVersion(entry.version, currentVersion) > 0
  );

  if (pending.length === 0) {
    log("Already up to date.");
    return;
  }

  log(`${pending.length} version(s) to apply: ${pending.map(e => "v" + e.version).join(", ")}`);

  // Backup folder named after the LAST version being applied (newest)
  const lastVersion = pending[pending.length - 1].version;
  const folderBackup = path.join(backupsDir, `backup_${lastVersion}`);
  await fs.ensureDir(folderBackup);

  let needsNpmInstall = false;

  for (const entry of pending) {
    log(`Applying v${entry.version}...`);

    for (const [remotePath, description] of Object.entries(entry.files || {})) {
      const localPath = path.join(rootDir, remotePath);
      const desc = description ? ` — ${description}` : "";

      // Config files: merge (never overwrite user settings)
      if (remotePath === "config.json" || remotePath === "configCommands.json") {
        let remoteContent;
        try { remoteContent = await fetchText(`${baseUrl}/${remotePath}`); }
        catch (e) { log(`  [!] Cannot fetch ${remotePath}: ${e.message}`); continue; }
        await backupFile(remotePath, folderBackup);
        await mergeConfig(localPath, remoteContent);
        log(`  [↑] Merged  ${remotePath}${desc}`);
        continue;
      }

      let remoteContent;
      try { remoteContent = await fetchText(`${baseUrl}/${remotePath}`); }
      catch (e) { log(`  [!] Cannot fetch ${remotePath}: ${e.message}`); continue; }

      const localExists = await fs.pathExists(localPath);
      if (localExists) {
        const localContent = await fs.readFile(localPath, "utf8");
        if (shouldSkip(localContent)) {
          log(`  [!] Skipped ${remotePath} (protected)`);
          continue;
        }
        // FIX: skip if content is identical — no backup needed
        if (normalizeNewlines(localContent) === normalizeNewlines(remoteContent)) {
          log(`  [=] Unchanged ${remotePath}`);
          continue;
        }
        await backupFile(remotePath, folderBackup);
        await fs.ensureDir(path.dirname(localPath));
        await fs.writeFile(localPath, remoteContent, "utf8");
        log(`  [↑] Updated ${remotePath}${desc}`);
      } else {
        await fs.ensureDir(path.dirname(localPath));
        await fs.writeFile(localPath, remoteContent, "utf8");
        log(`  [+] Added   ${remotePath}${desc}`);
      }
    }

    for (const [deletePath, description] of Object.entries(entry.deleteFiles || {})) {
      const localPath = path.join(rootDir, deletePath);
      const desc = description ? ` — ${description}` : "";
      if (await fs.pathExists(localPath)) {
        await backupFile(deletePath, folderBackup);
        const stat = await fs.lstat(localPath);
        if (stat.isDirectory()) await fs.remove(localPath);
        else await fs.unlink(localPath);
        log(`  [-] Removed ${deletePath}${desc}`);
      }
    }

    if (entry.reinstallDependencies) needsNpmInstall = true;
  }

  // FIX: update package.json ONCE after all versions finish (not inside loop)
  try {
    const remotePkg = await fetchText(`${baseUrl}/package.json`);
    const pkgObj = JSON.parse(remotePkg);
    const localPkg = await fs.readJson(packagePath);
    if (localPkg.scripts) pkgObj.scripts = { ...pkgObj.scripts, ...localPkg.scripts };
    await fs.writeJson(packagePath, pkgObj, { spaces: 2 });
    log(`package.json → v${pkgObj.version}`);
  } catch (e) { log(`[!] Could not update package.json: ${e.message}`); }

  // FIX: npm install once after all versions (not per-version inside loop)
  if (needsNpmInstall) {
    log("Running npm install...");
    execSync("npm install", { cwd: rootDir, stdio: "inherit" });
    log("npm install complete.");
  }

  log(`Update complete → backup saved at: backups/backup_${lastVersion}/`);
  log("Restart the bot to apply changes.");
}

async function main() {
  try {
    const versionsPath = path.join(rootDir, "versions.json");
    if (!(await fs.pathExists(versionsPath))) {
      throw new Error("versions.json not found. Run 'node update.js' first.");
    }
    const manifest = await fs.readJson(versionsPath);
    if (!Array.isArray(manifest)) throw new Error("versions.json must be an array.");
    await fs.ensureDir(backupsDir);
    await applyUpdates(manifest);
    log("Done.");
  } catch (error) {
    console.error("[updater] Error:", error.message);
    process.exitCode = 1;
  }
}

module.exports = main;

if (require.main === module) {
  main();
}
