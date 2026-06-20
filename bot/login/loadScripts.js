"use strict";

const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);
const log = require("../../logger/log.js");
const spinner = require("../../logger/spinner.js");
const { colors } = require("../../logger/colors.js");

const regExpCheckPackage = /require(\s+|)\((?:\s+|)(["'])(.*?)\2(?:\s+|)\)/g;
const packageAlready = [];

async function checkAndInstallPackages(filePath) {
  const contentFile = fs.readFileSync(filePath, "utf8");
  let allPackage = contentFile.match(regExpCheckPackage);
  if (allPackage) {
    allPackage = allPackage.map(p => p.match(/[`'"]([^`'"]+)[`'"]/)[1])
      .filter(p => p.indexOf("/") !== 0 && p.indexOf("./") !== 0 && p.indexOf("../") !== 0 && p.indexOf(__dirname) !== 0 && p !== "axios" && p !== "canvas" && p !== "fs" && p !== "path" && p !== "child_process" && p !== "util");
    for (let packageName of allPackage) {
      if (packageName.startsWith('@'))
        packageName = packageName.split('/').slice(0, 2).join('/');
      else
        packageName = packageName.split('/')[0];

      // Ignore core modules explicitly
      const coreModules = ["http", "https", "crypto", "os", "events", "stream"];
      if (coreModules.includes(packageName)) continue;

      if (!packageAlready.includes(packageName)) {
        packageAlready.push(packageName);
        if (!fs.existsSync(path.join(process.cwd(), "node_modules", packageName))) {
          log.info('PACKAGE', `Installing package ${colors.yellow(packageName)} for ${colors.yellow(path.basename(filePath))}...`);
          try {
            await execAsync(`npm install ${packageName} --save`);
            log.success('PACKAGE', `Installed package ${packageName} successfully`);
          } catch (err) {
            log.err('PACKAGE', `Failed to install package ${packageName}`);
            throw new Error(`Can't install package ${packageName}`);
          }
        }
      }
    }
  }
}

const CMDS_DIR = path.resolve(__dirname, "../../scripts/cmds");
const EVENTS_DIR = path.resolve(__dirname, "../../scripts/events");

/**
 * Safely load a module, returning null on error with a logged warning.
 */
function safeRequire(filePath) {
  try {
    // Clear cache to allow reload
    delete require.cache[require.resolve(filePath)];
    return require(filePath);
  } catch (e) {
    return { __error: e };
  }
}

/**
 * Load all command files from scripts/cmds/.
 * Skips files listed in configCommands.commandUnload.
 * @param {object} api
 */
async function loadCommands(api) {
  const unload = (global.ST.configCommands.commandUnload || []).map(n => n.toLowerCase());
  const files = fs.readdirSync(CMDS_DIR).filter(f => f.endsWith(".js"));

  let loaded = 0;
  let skipped = 0;
  let failed = 0;

  spinner.start(`Loading commands (0/${files.length})…`);

  for (const file of files) {
    const name = file.toLowerCase();
    // Skip if in unload list
    if (unload.includes(name) || unload.includes(name.replace(".js", ""))) {
      spinner.update(`Skipping command: ${file}`);
      skipped++;
      continue;
    }

    const filePath = path.join(CMDS_DIR, file);
    const mod = safeRequire(filePath);

    if (mod && mod.__error) {
      spinner.stop();
      log.warn("CMD LOAD", `⚠ ${file} — ${mod.__error.message}`);
      if (mod.__error.stack) {
        const lines = mod.__error.stack.split("\n").slice(0, 3).join(" | ");
        log.warn("CMD LOAD", `   at: ${lines}`);
      }
      spinner.start(`Loading commands (${loaded}/${files.length})…`);
      failed++;
      continue;
    }

    if (!mod || !mod.config || !mod.config.name) {
      log.warn("CMD LOAD", `${file} — missing config.name, skipping.`);
      failed++;
      continue;
    }

    // Run onLoad if defined
    if (typeof mod.onLoad === "function") {
      try {
        await mod.onLoad({ api, threadsData: global.ST.DB.threads, userData: global.ST.DB.users });
      } catch (e) {
        log.warn("CMD LOAD", `${file} onLoad error: ${e.message}`);
      }
    }

    global.ST.cmds.set(mod.config.name.toLowerCase(), mod);
    loaded++;
    spinner.update(`Loading commands (${loaded}/${files.length}) — ${mod.config.name}`);
  }

  let cmdSuffix = "";
  if (skipped > 0) cmdSuffix += `  |  Skipped: ${skipped}`;
  if (failed > 0) cmdSuffix += `  |  Failed: ${failed}`;
  spinner.succeed(`Commands loaded: ${loaded}${cmdSuffix}`);
  log.success("STEP 4", `Commands: ${loaded} loaded` + cmdSuffix);
}

/**
 * Load all event files from scripts/events/.
 * Skips files listed in configCommands.commandEventUnload.
 * @param {object} api
 */
async function loadEvents(api) {
  const unload = (global.ST.configCommands.commandEventUnload || []).map(n => n.toLowerCase());
  const files = fs.readdirSync(EVENTS_DIR).filter(f => f.endsWith(".js"));

  let loaded = 0;
  let skipped = 0;
  let failed = 0;

  spinner.start(`Loading events (0/${files.length})…`);

  for (const file of files) {
    const name = file.toLowerCase();
    if (unload.includes(name) || unload.includes(name.replace(".js", ""))) {
      spinner.update(`Skipping event: ${file}`);
      skipped++;
      continue;
    }

    const filePath = path.join(EVENTS_DIR, file);
    const mod = safeRequire(filePath);

    if (mod && mod.__error) {
      spinner.stop();
      log.warn("EVT LOAD", `⚠ ${file} — ${mod.__error.message}`);
      spinner.start(`Loading events (${loaded}/${files.length})…`);
      failed++;
      continue;
    }

    if (!mod || !mod.config || !mod.config.name) {
      log.warn("EVT LOAD", `${file} — missing config.name, skipping.`);
      failed++;
      continue;
    }

    if (typeof mod.onLoad === "function") {
      try {
        await mod.onLoad({ api, threadsData: global.ST.DB.threads, userData: global.ST.DB.users });
      } catch (e) {
        log.warn("EVT LOAD", `${file} onLoad error: ${e.message}`);
      }
    }

    global.ST.events.set(mod.config.name.toLowerCase(), mod);
    loaded++;
    spinner.update(`Loading events (${loaded}/${files.length}) — ${mod.config.name}`);
  }

  let evtSuffix = "";
  if (skipped > 0) evtSuffix += `  |  Skipped: ${skipped}`;
  if (failed > 0) evtSuffix += `  |  Failed: ${failed}`;
  spinner.succeed(`Events loaded: ${loaded}${evtSuffix}`);
  log.success("STEP 4", `Events: ${loaded} loaded` + evtSuffix);
}

function watchScripts(api) {
  let debounceMap = new Map();

  const handleWatch = (dir, isCmd) => (eventType, filename) => {
    if (!filename || !filename.endsWith(".js")) return;
    const key = (isCmd ? "cmd_" : "evt_") + filename;

    if (debounceMap.has(key)) clearTimeout(debounceMap.get(key));

    debounceMap.set(key, setTimeout(async () => {
      debounceMap.delete(key);
      try {
        const name = filename.replace(".js", "");

        // If file was deleted, unload it
        if (!fs.existsSync(path.join(dir, filename))) {
          if (isCmd) {
            if (global.ST.cmds.has(name)) {
              unloadCmd(name);
              log.success("AUTO LOAD", `Command ${name} unloaded (file deleted).`);
            }
          } else {
            if (global.ST.events.has(name)) {
              unloadEvent(name);
              log.success("AUTO LOAD", `Event ${name} unloaded (file deleted).`);
            }
          }
          return;
        }

        // It was added or changed
        if (isCmd) {
          if (global.ST.cmds.has(name)) unloadCmd(name);
          const mod = await loadCmd(filename, api);
          log.success("AUTO LOAD", `Command ${mod.config.name} reloaded automatically.`);
        } else {
          if (global.ST.events.has(name)) unloadEvent(name);
          const mod = await loadEvent(filename, api);
          log.success("AUTO LOAD", `Event ${mod.config.name} reloaded automatically.`);
        }
      } catch (err) {
        log.err("AUTO LOAD", `Failed to reload ${filename}: ${err.message}`);
      }
    }, 500));
  };

  fs.watch(CMDS_DIR, handleWatch(CMDS_DIR, true));
  if (fs.existsSync(EVENTS_DIR)) {
    fs.watch(EVENTS_DIR, handleWatch(EVENTS_DIR, false));
  }
}

/**
 * Main step-4 loader.
 * @param {object} api
 */
async function loadScripts(api) {
  log.divider("STEP 4 — SCRIPTS");
  await loadCommands(api);
  await loadEvents(api);

  if (global.ST.config.autoLoadScripts && global.ST.config.autoLoadScripts.enable) {
    watchScripts(api);
    log.info("AUTO LOAD", "Watching scripts for changes...");
  }
}

// ─── Dynamic management helpers (used by cmd/event cmds) ─────────────────────

/**
 * Load a single command by name (without .js).
 */
async function loadCmd(cmdName, api) {
  const file = cmdName.endsWith(".js") ? cmdName : cmdName + ".js";
  const filePath = path.join(CMDS_DIR, file);
  if (!fs.existsSync(filePath)) throw new Error("Command file not found: " + file);
  await checkAndInstallPackages(filePath);
  const mod = safeRequire(filePath);
  if (mod && mod.__error) throw mod.__error;
  if (!mod || !mod.config || !mod.config.name) throw new Error("Invalid command structure in: " + file);
  if (typeof mod.onLoad === "function") {
    await mod.onLoad({ api, threadsData: global.ST.DB.threads, userData: global.ST.DB.users }).catch(() => { });
  }
  global.ST.cmds.set(mod.config.name.toLowerCase(), mod);
  return mod;
}

/**
 * Unload a single command by name.
 */
function unloadCmd(cmdName) {
  const key = cmdName.toLowerCase().replace(".js", "");
  if (!global.ST.cmds.has(key)) throw new Error("Command not loaded: " + key);
  global.ST.cmds.delete(key);
}

/**
 * Reload a single command by name.
 */
async function reloadCmd(cmdName, api) {
  unloadCmd(cmdName);
  return loadCmd(cmdName, api);
}

/**
 * Load a single event by name.
 */
async function loadEvent(evtName, api) {
  const file = evtName.endsWith(".js") ? evtName : evtName + ".js";
  const filePath = path.join(EVENTS_DIR, file);
  if (!fs.existsSync(filePath)) throw new Error("Event file not found: " + file);
  await checkAndInstallPackages(filePath);
  const mod = safeRequire(filePath);
  if (mod && mod.__error) throw mod.__error;
  if (!mod || !mod.config || !mod.config.name) throw new Error("Invalid event structure in: " + file);
  if (typeof mod.onLoad === "function") {
    await mod.onLoad({ api, threadsData: global.ST.DB.threads, userData: global.ST.DB.users }).catch(() => { });
  }
  global.ST.events.set(mod.config.name.toLowerCase(), mod);
  return mod;
}

/**
 * Unload a single event by name.
 */
function unloadEvent(evtName) {
  const key = evtName.toLowerCase().replace(".js", "");
  if (!global.ST.events.has(key)) throw new Error("Event not loaded: " + key);
  global.ST.events.delete(key);
}

/**
 * Reload a single event by name.
 */
async function reloadEvent(evtName, api) {
  unloadEvent(evtName);
  return loadEvent(evtName, api);
}

module.exports = loadScripts;
module.exports.loadCmd = loadCmd;
module.exports.unloadCmd = unloadCmd;
module.exports.reloadCmd = reloadCmd;
module.exports.loadEvent = loadEvent;
module.exports.unloadEvent = unloadEvent;
module.exports.reloadEvent = reloadEvent;
