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

async function ensureBackupFolder(version) {
  const versionBackupDir = path.join(backupsDir, `backup_${version}`);
  await fs.ensureDir(versionBackupDir);
  return versionBackupDir;
}

async function updateFile(remotePath, localPath, version) {
  const remoteUrl = `${baseUrl}/${remotePath}`;
  const fileContent = await fetchText(remoteUrl);
  const localExists = await fs.pathExists(localPath);

  if (localExists && shouldSkip(await fs.readFile(localPath, "utf8"))) {
    log(`Skipping protected file: ${localPath}`);
    return;
  }

  const backupDir = await ensureBackupFolder(version);
  if (localExists) {
    await fs.copy(localPath, path.join(backupDir, path.basename(localPath)));
  }

  await fs.ensureDir(path.dirname(localPath));
  await fs.writeFile(localPath, fileContent, "utf8");
  log(`Updated ${localPath}`);
}

async function deleteFile(remotePath, localPath, version) {
  const backupDir = await ensureBackupFolder(version);
  if (await fs.pathExists(localPath)) {
    await fs.copy(localPath, path.join(backupDir, path.basename(localPath)));
    await fs.remove(localPath);
    log(`Deleted ${localPath}`);
  }
}

async function applyUpdates(manifest) {
  const currentVersion = require(packagePath).version;
  const pending = manifest.filter(entry => {
    const current = currentVersion.split(".").map(Number);
    const target = entry.version.split(".").map(Number);
    return target.some((value, index) => value > (current[index] || 0));
  });

  for (const entry of pending) {
    log(`Applying version ${entry.version}`);
    for (const [remotePath, description] of Object.entries(entry.files || {})) {
      const localPath = path.join(rootDir, remotePath);
      if (remotePath === "config.json" || remotePath === "configCommands.json") {
        const remoteUrl = `${baseUrl}/${remotePath}`;
        const fileContent = await fetchText(remoteUrl);
        await mergeConfig(localPath, fileContent);
        log(`Merged config: ${remotePath} (${description || "no description"})`);
      } else {
        await updateFile(remotePath, localPath, entry.version);
      }
    }

    for (const [deletePath, description] of Object.entries(entry.deleteFiles || {})) {
      await deleteFile(deletePath, path.join(rootDir, deletePath), entry.version);
      log(`Removed ${deletePath} (${description || "no description"})`);
    }

    if (entry.reinstallDependencies) {
      log("Installing dependencies...");
      execSync("npm install", { cwd: rootDir, stdio: "inherit" });
    }

    if (entry.version) {
      const remotePackage = await fetchText(`${baseUrl}/package.json`);
      await fs.writeFile(packagePath, remotePackage, "utf8");
      log(`Updated package.json to ${entry.version}`);
    }
  }
}

async function main() {
  try {
    const manifestRaw = await fetchText(manifestUrl);
    const manifest = JSON.parse(manifestRaw);

    if (!Array.isArray(manifest)) {
      throw new Error("versions.json must be an array.");
    }

    await applyUpdates(manifest);
    log("Update check complete.");
  } catch (error) {
    console.error("[updater] Error:", error.message);
    process.exitCode = 1;
  }
}

module.exports = main;

if (require.main === module) {
  main();
}
