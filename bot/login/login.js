"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const zlib = require("zlib");

const CONFIG_PATH = path.resolve(process.cwd(), "config.json");
const CMD_CFG_PATH = path.resolve(process.cwd(), "configCommands.json");
const CACHE_DIR = path.resolve(process.cwd(), "cache");
const RESTART_FILE = path.join(CACHE_DIR, "restart.txt");

// ─── Helpers ─────────────────────────────────────────────────────────────────
function ask(prompt) {
  return new Promise(resolve => {
    const iface = readline.createInterface({ input: process.stdin, output: process.stdout });
    iface.question(prompt, ans => { iface.close(); resolve(ans.trim()); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function checkVersionUpdate(currentVersion) {
  const repoPkgUrl = "https://raw.githubusercontent.com/update-1/Whatsapp-Goatbot/main/package.json";

  try {
    const axios = require("axios");
    const response = await axios.get(repoPkgUrl, {
      timeout: 10000,
      responseType: "json"
    });

    const remoteVersion = response?.data?.version;
    if (!remoteVersion) return false;

    const toParts = (v) => String(v || "0").split(".").map(n => Number.isNaN(Number(n)) ? 0 : Number(n));
    const localParts = toParts(currentVersion);
    const remoteParts = toParts(remoteVersion);

    const compareVersions = (a, b) => {
      const max = Math.max(a.length, b.length);
      for (let i = 0; i < max; i++) {
        const av = a[i] || 0;
        const bv = b[i] || 0;
        if (av > bv) return 1;
        if (av < bv) return -1;
      }
      return 0;
    };

    const result = compareVersions(remoteParts, localParts);
    if (result > 0) {
      global.log.info("VERSION", `Update available: ${currentVersion} → ${remoteVersion}`);
      return true;
    } else if (result === 0) {
      global.log.info("VERSION", `Version check: ${currentVersion} (up to date)`);
      return false;
    } else {
      global.log.info("VERSION", `Version check: ${currentVersion} (local is newer)`);
      return true;
    }
  } catch (error) {
    global.log.warn("VERSION", "Could not verify remote version: " + error.message);
    return false;
  }
}

// ─── Config helpers ───────────────────────────────────────────────────────────
function loadConfig() {
  try {
    global.GoatBot.config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (e) {
    global.log.err("CONFIG", "Failed to load config.json: " + e.message);
    process.exit(1);
  }
}

function loadConfigCommands() {
  try {
    global.GoatBot.configCommands = JSON.parse(fs.readFileSync(CMD_CFG_PATH, "utf8"));
  } catch (e) {
    global.GoatBot.configCommands = { commandUnload: [], commandEventUnload: [], commandAllowLoad: [] };
  }
}

function setupWatchers() {
  let _cfgD = null, _cmdD = null;
  fs.watch(CONFIG_PATH, () => {
    clearTimeout(_cfgD);
    _cfgD = setTimeout(() => {
      try {
        global.GoatBot.config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
        global.log.info("CONFIG", "config.json reloaded ✓");
      } catch (_) { }
    }, 500);
  });
  fs.watch(CMD_CFG_PATH, () => {
    clearTimeout(_cmdD);
    _cmdD = setTimeout(() => {
      try {
        global.GoatBot.configCommands = JSON.parse(fs.readFileSync(CMD_CFG_PATH, "utf8"));
        global.log.info("CONFIG", "configCommands.json reloaded ✓");
      } catch (_) { }
    }, 500);
  });
}

function saveToConfig(phoneNumber, loginMode) {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    cfg.phoneNumber = phoneNumber;
    cfg.loginMode = loginMode;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
    global.GoatBot.config.phoneNumber = phoneNumber;
    global.GoatBot.config.loginMode = loginMode;
  } catch (e) {
    global.log.warn("LOGIN", "Could not save to config.json: " + e.message);
  }
}

// ─── Session ID Import ────────────────────────────────────────────────────────
/**
 * Checks config.json (or env SESSION_ID) for a sessionID and imports it.
 * Supports KnightBot! (zlib+base64), plain Base64 JSON, and Mega.nz URL formats.
 * After a successful import, clears sessionID from config.json to prevent re-import.
 * @returns {Promise<boolean>} true if session was imported
 */
async function checkAndImportSession() {
  const cfg = global.GoatBot.config;
  const sessionId = (process.env.SESSION_ID || cfg.sessionID || "").trim();

  if (!sessionId) return false;

  const authFolder = path.resolve(process.cwd(), cfg.authFolder || "./auth");

  global.log.info("SESSION", "Session ID detected — attempting import…");

  try {
    let sessionData = null;
    let url = sessionId;

    // ── Format 1: RomeoBot! (zlib compressed + base64) ──────────────────────
    if (url.startsWith("RomeoBot!")) {
      const base64Str = url.substring("RomeoBot!".length);
      const decompressed = zlib.unzipSync(Buffer.from(base64Str, "base64"));
      sessionData = decompressed;
      global.log.info("SESSION", "Format detected: RomeoBot compressed");
    }

    // ── Format 2: RomeoBot with ~ separator ──────────────────────────────────
    else if (url.includes("~")) {
      const base64Str = url.split("~")[1] || url.split("~")[0];
      try { url = Buffer.from(base64Str, "base64").toString("utf8"); } catch (_) { }
      global.log.info("SESSION", "Format detected: RomeoBot ~ separator");
    }

    // ── Format 3: Mega.nz URL ─────────────────────────────────────────────────
    if (!sessionData && url.startsWith("http") && url.includes("mega.nz")) {
      global.log.info("SESSION", "Format detected: Mega.nz URL — downloading…");
      try {
        // Use dynamic import since megajs may be ESM; fall back to require
        let megaModule;
        try { megaModule = require("megajs"); } catch (_) { megaModule = null; }
        if (megaModule) {
          const file = megaModule.File.fromURL(url);
          await file.loadAttributes();
          sessionData = await file.downloadBuffer();
        } else {
          global.log.warn("SESSION", "megajs not found — skipping Mega download");
        }
      } catch (megaErr) {
        global.log.err("SESSION", "Mega download failed: " + megaErr.message);
      }
    }

    // ── Format 5: Direct HTTP/HTTPS URL ───────────────────────────────────────
    if (!sessionData && url.startsWith("http")) {
      global.log.info("SESSION", "Format detected: Direct URL — downloading…");
      try {
        const axios = require("axios");
        const response = await axios.get(url, { responseType: "arraybuffer" });
        sessionData = Buffer.from(response.data);
      } catch (err) {
        global.log.err("SESSION", "Direct URL download failed: " + err.message);
      }
    }

    // ── Format 4: Plain Base64 (JSON) ─────────────────────────────────────────
    if (!sessionData && !url.startsWith("http")) {
      try {
        const decoded = Buffer.from(url, "base64").toString("utf8");
        JSON.parse(decoded); // validates JSON
        sessionData = Buffer.from(decoded, "utf8");
        global.log.info("SESSION", "Format detected: Base64 JSON");
      } catch (_) {
        global.log.warn("SESSION", "Could not decode as Base64 JSON");
      }
    }

    if (sessionData) {
      // Ensure auth folder exists and is empty
      if (!fs.existsSync(authFolder)) fs.mkdirSync(authFolder, { recursive: true });
      // Write creds.json
      fs.writeFileSync(path.join(authFolder, "creds.json"), sessionData);

      // Clear sessionID from config.json (security)
      try {
        const rawCfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
        rawCfg.sessionID = "";
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(rawCfg, null, 2), "utf8");
        global.GoatBot.config.sessionID = "";
      } catch (_) { }

      global.log.success("SESSION", "✅ Session imported to " + authFolder + "/creds.json");
      return true;
    } else {
      global.log.warn("SESSION", "⚠️ Could not decode Session ID — skipping import");
    }
  } catch (err) {
    global.log.err("SESSION", "❌ Session import failed: " + err.message);
  }

  return false;
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────
function hasAuth(authFolder) {
  if (!fs.existsSync(authFolder)) return false;
  return fs.readdirSync(authFolder).some(f => f.includes("creds") || f.endsWith(".json"));
}

function clearAuth(authFolder) {
  try {
    if (fs.existsSync(authFolder)) {
      fs.rmSync(authFolder, { recursive: true, force: true });
      global.log.warn("LOGIN", "Auth cleared — will prompt fresh login.");
    }
  } catch (_) { }
}

// ─── Restart notification ─────────────────────────────────────────────────────
async function checkRestartFile(api) {
  try {
    if (!fs.existsSync(RESTART_FILE)) return;
    const raw = fs.readFileSync(RESTART_FILE, "utf8");
    const data = JSON.parse(raw);
    fs.unlinkSync(RESTART_FILE);

    if (!data.threads || !data.time) return;
    const elapsed = ((Date.now() - data.time) / 1000).toFixed(2);
    const msg = `✅ Bot restarted successfully!\n⏱️ Time taken: ${elapsed}s`;

    for (const tid of data.threads) {
      try { await api.sendMessage({ body: msg }, tid); } catch (_) { }
    }
    global.log.success("RESTART", `Notified ${data.threads.length} thread(s) — took ${elapsed}s`);
  } catch (e) {
    global.log.warn("RESTART", "restart.txt read error: " + e.message);
  }
}

// ─── Connect ──────────────────────────────────────────────────────────────────
async function connect() {
  const cfg = global.GoatBot.config;
  const authFolder = path.resolve(process.cwd(), cfg.authFolder || "./auth");
  const baileys = require("./baileys.js");
  const c = global.utils.colors;

  let phoneNumber = (cfg.phoneNumber || "").trim();
  let loginMode = (cfg.loginMode || "").trim().toLowerCase();

  if (hasAuth(authFolder)) {
    global.log.info("LOGIN", "Auth found — restoring session…");
    return await attemptConnect(baileys, { authFolder, phoneNumber: null, usePairingCode: false, printQR: false });
  }

  if (!phoneNumber) {
    console.log(c.cyanBright("\n  Enter your WhatsApp number with country code (e.g. 8801XXXXXXXXX):"));
    phoneNumber = await ask("  Number: ");
    if (!phoneNumber || !/^\d{7,}$/.test(phoneNumber)) {
      global.log.err("LOGIN", "Invalid number. Exiting.");
      process.exit(1);
    }
  }

  if (loginMode !== "pair" && loginMode !== "qr") {
    console.log(c.cyanBright("\n  Select login mode:"));
    console.log("    " + c.yellowBright("1") + " — Pair Code  (recommended)");
    console.log("    " + c.yellowBright("2") + " — QR Code");
    const choice = await ask("  Enter 1 or 2: ");
    loginMode = choice === "2" ? "qr" : "pair";
  }

  saveToConfig(phoneNumber, loginMode);

  const usePairingCode = loginMode === "pair";
  global.log.info("LOGIN", "Mode: " + (usePairingCode ? "Pair Code" : "QR Code") + " | Number: " + phoneNumber);

  return await attemptConnect(baileys, { authFolder, phoneNumber, usePairingCode, printQR: !usePairingCode });
}

function attemptConnect(baileys, opts) {
  return new Promise((resolve, reject) => {
    global.utils.spinner.start("Connecting to WhatsApp…", { preset: "dots" });

    let resolved = false;

    baileys({
      authFolder: opts.authFolder,
      phoneNumber: opts.phoneNumber,
      usePairingCode: opts.usePairingCode,
      printQR: opts.printQR,
      skipUpdateCheck: true,
      globalOptions: {
        selfListen: global.GoatBot.config.listen?.selfListen ?? false,
        listenEvents: global.GoatBot.config.listen?.listenEvents ?? true,
        autoMarkDelivery: global.GoatBot.config.listen?.autoMarkDelivery ?? false,
        autoReconnect: global.GoatBot.config.listen?.autoReconnect ?? true,
        enableTypingIndicator: false,
      },
    }, (err, api) => {
      if (err) {
        if (resolved) return;
        resolved = true;
        global.utils.spinner.fail("Connection failed: " + (err.message || String(err)));

        if (/logout|logged.?out/i.test(String(err.message || err))) {
          clearAuth(opts.authFolder);
          global.log.info("LOGIN", "Restarting login flow…");
          connect().then(resolve).catch(reject);
          return;
        }
        reject(err);
        return;
      }

      if (resolved) return;
      resolved = true;
      global.utils.spinner.succeed("Connected to WhatsApp ✓");

      const selfID = api.getCurrentUserID ? api.getCurrentUserID() : (api.ctx?.selfID || "");
      const phone = selfID.split(":")[0].split("@")[0] || selfID;
      global.log.success("ACCOUNT", "Connected as: " + phone);

      resolve(api);
    });
  });
}

// ─── Main startup — all 7 steps ───────────────────────────────────────────────
module.exports = async function startBot() {
  // ─── Welcome Logo Banner ──────────────────────────────────────────────────
  const packageJson = require("../../package.json");
  const currentVersion = packageJson.version || "1.0.0";
  const grad = (text, stops) => global.gradient ? global.gradient(text, stops) : text;

  const versionMismatch = await checkVersionUpdate(currentVersion);

  const titles = [
    [
      "██████╗  ██████╗  █████╗ ████████╗    ██╗   ██╗██████╗",
      "██╔════╝ ██╔═══██╗██╔══██╗╚══██╔══╝    ██║   ██║╚════██╗",
      "██║  ███╗██║   ██║███████║   ██║       ██║   ██║ █████╔╝",
      "██║   ██║██║   ██║██╔══██║   ██║       ╚██╗ ██╔╝██╔═══╝",
      "╚██████╔╝╚██████╔╝██║  ██║   ██║        ╚████╔╝ ███████╗",
      "╚═════╝  ╚═════╝ ╚═╝  ╚═╝   ╚═╝         ╚═══╝  ╚══════╝"
    ],
    [
      "█▀▀ █▀█ ▄▀█ ▀█▀  █▄▄ █▀█ ▀█▀  █░█ ▀█",
      "█▄█ █▄█ █▀█ ░█░  █▄█ █▄█ ░█░  ▀▄▀ █▄"
    ],
    [
      "W H A T S A P P  G O A T B O T @" + currentVersion
    ],
    [
      "WHATSAPP-GOATBOT"
    ]
  ];
  const maxWidth = process.stdout.columns || 80;
  const title = maxWidth > 58 ?
    titles[0] :
    maxWidth > 36 ?
      titles[1] :
      maxWidth > 26 ?
        titles[2] :
        titles[3];

  let widthConsole = process.stdout.columns || 80;
  if (widthConsole > 50)
    widthConsole = 50;

  function createLine(content, isMaxWidth = false) {
    if (!content)
      return Array(isMaxWidth ? (process.stdout.columns || 80) : widthConsole).fill("─").join("");
    else {
      content = ` ${content.trim()} `;
      const lengthContent = content.length;
      const lengthLine = isMaxWidth ? (process.stdout.columns || 80) - lengthContent : widthConsole - lengthContent;
      let left = Math.floor(lengthLine / 2);
      if (left < 0 || isNaN(left))
        left = 0;
      const lineOne = Array(left).fill("─").join("");
      return lineOne + content + lineOne;
    }
  }

  function centerText(text, length) {
    const columns = process.stdout.columns || 80;
    const left = Math.max(0, Math.floor((columns - (length || text.length)) / 2));
    const right = Math.max(0, columns - left - (length || text.length));
    console.log(" ".repeat(left) + text + " ".repeat(right));
  }

  console.log(grad(createLine(null, true), ["#f5af19", "#f12711"]));
  console.log();
  for (const text of title) {
    const textColor = grad(text, ["#FA8BFF", "#2BD2FF", "#2BFF88"]);
    centerText(textColor, text.length);
  }
  let subTitle = `Whatsapp-Goatbot V2@${currentVersion} - A simple Whatsapp Chat Bot use personal account`;
  const subTitleArray = [];
  if (subTitle.length > maxWidth) {
    while (subTitle.length > maxWidth) {
      let lastSpace = subTitle.slice(0, maxWidth).lastIndexOf(' ');
      lastSpace = lastSpace == -1 ? maxWidth : lastSpace;
      subTitleArray.push(subTitle.slice(0, lastSpace).trim());
      subTitle = subTitle.slice(lastSpace).trim();
    }
    subTitle ? subTitleArray.push(subTitle) : '';
  } else {
    subTitleArray.push(subTitle);
  }
  const author = "Created by EF-Prime-MD";
  const srcUrl = "Source code: https://github.com/efkidgamerdev";
  const fakeRelease = "ALL VERSIONS NOT RELEASED HERE ARE FAKE";
  for (const t of subTitleArray) {
    const textColor2 = grad(t, ["#9F98E8", "#AFF6CF"]);
    centerText(textColor2, t.length);
  }
  centerText(grad(author, ["#9F98E8", "#AFF6CF"]), author.length);
  centerText(grad(srcUrl, ["#9F98E8", "#AFF6CF"]), srcUrl.length);
  if (versionMismatch) {
    centerText(grad(fakeRelease, ["#f5af19", "#f12711"]), fakeRelease.length);
  }
  console.log();

  const startLoggingText = "START LOGGING IN";
  const startLoggingLine = createLine(startLoggingText, true);
  console.log(grad(startLoggingLine, ["#f5af19", "#f12711"]));
  console.log();

  // ── Step 1: Config ────────────────────────────────────────────────────────
  global.log.divider("CONFIG");
  loadConfig();
  loadConfigCommands();
  setupWatchers();
  global.log.success("CONFIG", "Config loaded — prefix: " + (global.GoatBot.config.prefix || "!") +
    " | bot: " + (global.GoatBot.config.botName || "EF-Prime Bot"));

  await sleep(120);

  // ── Step 2: Session ID → auto-import before connect ─────────────────────
  global.log.divider("SESSION / CONNECT");
  await checkAndImportSession();
  const api = await connect();
  global.GoatBot.api = api;

  // Send restart notification if applicable
  await checkRestartFile(api);

  await sleep(120);

  // ── Step 3: Database ──────────────────────────────────────────────────────
  const loadData = require("./loadData.js");
  await loadData(api);

  await sleep(120);

  // ── Step 4: Commands + Events ─────────────────────────────────────────────
  const loadScripts = require("./loadScripts.js");
  await loadScripts(api);

  await sleep(120);

  // Start Express & Socket.IO now that API and commands are ready
  global.log.divider("EXPRESS + SOCKET STARTUP");
  const { startExpress, getApp, getIO } = require("./socketIo.js");
  await startExpress();

  // Start Dashboard Backend
  const { startDashboard } = require("../../dashboard/index.js");
  await startDashboard(getApp(), getIO());

  require("../autoUptime.js").startAutoUptime();

  await sleep(120);

  // ── Step 6: Admin list ────────────────────────────────────────────────────
  const admins = global.GoatBot.config.adminBot || [];
  const { colors: _c } = require("../../logger/colors.js");
  global.log.divider("ADMINS");
  if (admins.length === 0) {
    console.log("  " + _c.hex("#7f8fa6")("─── not configured ───"));
  } else {
    for (let i = 0; i < admins.length; i++) {
      const uid = admins[i];
      const phone = uid.split(":")[0].split("@")[0];
      let name = "";

      // 1) Try Baileys contacts map (fastest, no API call)
      try {
        const sock = api.sock;
        if (sock && sock.contacts) {
          const c = sock.contacts[phone + "@s.whatsapp.net"]
            || sock.contacts[phone + "@lid"]
            || sock.contacts[uid + "@s.whatsapp.net"];
          if (c) name = c.name || c.notify || c.verifiedName || "";
        }
      } catch (_) { }

      // 2) Try DB as fallback
      if (!name) {
        try {
          const userRec = await global.GoatBot.DB.userData(uid);
          if (userRec && userRec.name && userRec.name !== "Unknown") name = userRec.name;
        } catch (_) { }
      }

      await sleep(50);
      const num = _c.hex("#a29bfe")(`${i + 1}.`);
      const nameStr = name
        ? _c.hex("#22d39a")(name) + " " + _c.gray("(" + phone + ")")
        : _c.hex("#22d39a")(phone);
      console.log("  " + num + " " + nameStr);
    }
  }
  global.log.divider();

  await sleep(150);

  // ── Step 7: Ready ─────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - global.GoatBot.startTime) / 1000).toFixed(2);
  const cmds = global.GoatBot.cmds.size;
  const events = global.GoatBot.events.size;
  const prefix = global.GoatBot.config.prefix || "!";
  const botName = global.GoatBot.config.botName || "Baileys Bot";

  global.log.success("READY",
    botName + " ready in " + elapsed + "s  |  " +
    cmds + " cmds  |  " + events + " events  |  prefix: " + prefix
  );

  // ── Keepalive — prevents Node from exiting if Baileys unref()s its socket ─
  const _keepAlive = setInterval(() => { }, 30000);
  _keepAlive.unref && _keepAlive.unref(); // don't block graceful shutdown, just prevent premature exit
  // Re-ref so we actually keep process alive
  if (_keepAlive.ref) _keepAlive.ref();

  // ── Start listening ───────────────────────────────────────────────────────
  const handlerEvent = require("../handler/handlerEvent.js");

  api.listen((err, event) => {
    // listenMqtt passes stop_listen as first arg (not a real error)
    if (err && err.type === "stop_listen") {
      global.log.warn("CONNECTION", "Connection closed — restarting process for a clean reconnect...");
      process.exit(2);
      return;
    }
    if (err && !(err instanceof Error)) {
      // It's a non-Error first-arg event — treat as event
      handlerEvent(api, err).catch(() => { });
      return;
    }
    if (err) {
      global.log.err("LISTEN", err.message || String(err));
      return;
    }
    handlerEvent(api, event).catch(e => {
      global.log.err("HANDLER", e.message || String(e));
    });
  });
};
