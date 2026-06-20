"use strict";

const { Server } = require("socket.io");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

require('events').EventEmitter.defaultMaxListeners = 500;
const pairRouter = require("../../dashboard/pair/pair.js");
const qrRouter = require("../../dashboard/pair/qr.js");

let _log = null;
function getLog() {
  if (_log) return _log;
  try { _log = require("../../logger/log.js"); } catch (_) {}
  if (!_log) {
    _log = {
      info: (tag, ...a) => console.log(`[INFO] ${tag}:`, ...a),
      err:  (tag, ...a) => console.log(`[ERR]  ${tag}:`, ...a),
      warn: (tag, ...a) => console.log(`[WARN] ${tag}:`, ...a),
      success: (tag, ...a) => console.log(`[DONE] ${tag}:`, ...a),
    };
  }
  return _log;
}

let _server = null;
let _io     = null;
const logHistory = [];
const MAX_LOGS = 200;




// Hook console log methods to collect and stream logs
function hookConsole() {
  const originalLog = console.log;
  console.log = function(...args) {
    originalLog.apply(console, args);
    const message = args.map(arg => {
      if (arg && typeof arg === "object") {
        try { return JSON.stringify(arg, null, 2); } catch (_) { return String(arg); }
      }
      return String(arg);
    }).join(" ");
    
    logHistory.push(message);
    if (logHistory.length > MAX_LOGS) {
      logHistory.shift();
    }
    
    if (_io) {
      _io.emit("console_log", message);
    }
  };
}

// System stats helpers
function cpuAverage() {
  let totalIdle = 0, totalTick = 0;
  const cpus = os.cpus();
  if (!cpus) return { idle: 0, total: 0 };
  for (let i = 0, len = cpus.length; i < len; i++) {
    const cpu = cpus[i];
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }
  return { idle: totalIdle / cpus.length, total: totalTick / cpus.length };
}

function getCpuUsage() {
  return new Promise((resolve) => {
    const startMeasure = cpuAverage();
    setTimeout(() => {
      const endMeasure = cpuAverage();
      const idleDifference = endMeasure.idle - startMeasure.idle;
      const totalDifference = endMeasure.total - startMeasure.total;
      if (totalDifference === 0) return resolve(0);
      const percentageCPU = 100 - ~~(100 * idleDifference / totalDifference);
      resolve(percentageCPU);
    }, 100);
  });
}

function getStorageInfo() {
  return new Promise((resolve) => {
    const drive = path.resolve(process.cwd()).substring(0, 2); // e.g. "E:" or "C:"
    const cmd = `powershell -Command "Get-CimInstance Win32_LogicalDisk | Where-Object {$_.DeviceID -eq '${drive}'} | Select-Object Size, FreeSpace | ConvertTo-Json"`;
    exec(cmd, (err, stdout) => {
      if (err) {
        return resolve({ size: 500 * 1024 * 1024 * 1024, free: 250 * 1024 * 1024 * 1024 });
      }
      try {
        const data = JSON.parse(stdout.trim());
        const item = Array.isArray(data) ? data[0] : data;
        resolve({
          size: Number(item.Size || item.size || 500 * 1024 * 1024 * 1024),
          free: Number(item.FreeSpace || item.freespace || 250 * 1024 * 1024 * 1024)
        });
      } catch (_) {
        resolve({ size: 500 * 1024 * 1024 * 1024, free: 250 * 1024 * 1024 * 1024 });
      }
    });
  });
}

let packageVersion = "1.0.0";
let depCount = 0;
try {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"));
  packageVersion = pkg.version || "1.0.0";
  depCount = Object.keys(pkg.dependencies || {}).length + Object.keys(pkg.devDependencies || {}).length;
} catch (_) {}

function checkAuth(req, res, next) {
  const cfg = global.ST && global.ST.config;
  const token = cfg && cfg.express && cfg.express.secretToken ? cfg.express.secretToken : "Romeo";
  
  const authHeader = req.headers.authorization;
  const reqToken = req.query.token || (authHeader && authHeader.split(" ")[1]) || req.body.token;

  if (reqToken !== token) {
    return res.status(401).json({ status: "error", message: "Unauthorized: Invalid token" });
  }
  next();
}

/**
 * Step 5 — Start Express HTTP server + Socket.IO.
 */
async function startExpress() {
  const log = getLog();
  const cfg = global.ST && global.ST.config;

  if (!cfg || !cfg.express || !cfg.express.enable) {
    log.info("STEP 5", "Express/Socket disabled in config");
    return;
  }

  let express, http;
  try {
    express = require("express");
    http    = require("http");
  } catch (e) {
    log.warn("STEP 5", "express not installed — skipping. (" + e.message + ")");
    return;
  }

  const app    = express();
  const server = http.createServer(app);
  const port   = (cfg.express && cfg.express.port) || 3000;

  app.use(express.json());

  // Serve static files from dashboard folder
  const dashboardDir = path.resolve(process.cwd(), "dashboard");
  if (!fs.existsSync(dashboardDir)) {
    fs.mkdirSync(dashboardDir, { recursive: true });
  }
  app.use(express.static(dashboardDir));

  // Public compatibility endpoints
  app.get("/uptime", (req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });

  app.get("/stats", (req, res) => {
    res.json({
      cmds:   global.ST.cmds ? global.ST.cmds.size : 0,
      events: global.ST.events ? global.ST.events.size : 0,
      uptime: process.uptime(),
    });
  });

  // Authenticated APIs
  app.get("/api/metrics", checkAuth, async (req, res) => {
    try {
      const cpu = await getCpuUsage();
      const storage = await getStorageInfo();
      
      let threads = 0;
      let users = 0;
      let members = 0;
      
      if (global.ST.DB) {
        if (global.ST.DB.threads) {
          threads = await global.ST.DB.threads.count();
          try {
            const allThreads = await global.ST.DB.threads.getAll();
            for (const tid in allThreads) {
              members += allThreads[tid].totalMember || 0;
            }
          } catch (_) {}
        }
        if (global.ST.DB.users) {
          users = await global.ST.DB.users.count();
        }
      }

      res.json({
        uptime: process.uptime(),
        memory: {
          rss: process.memoryUsage().rss,
          heapUsed: process.memoryUsage().heapUsed,
          heapTotal: process.memoryUsage().heapTotal,
          systemTotal: os.totalmem(),
          systemFree: os.freemem(),
        },
        cpu: cpu,
        version: packageVersion,
        nodeVersion: process.version,
        storage: {
          total: storage.size,
          free: storage.free,
        },
        os: `${os.type()} ${os.release()} (${os.arch()})`,
        dependencies: depCount,
        activeThreads: threads,
        totalUsers: users,
        members: members,
        commands: global.ST.cmds ? global.ST.cmds.size : 0,
        events: global.ST.events ? global.ST.events.size : 0,
      });
    } catch (err) {
      res.status(500).json({ status: "error", message: err.message });
    }
  });

  app.get("/api/threads", checkAuth, async (req, res) => {
    try {
      if (global.ST.DB && global.ST.DB.threads) {
        const all = await global.ST.DB.threads.getAll();
        return res.json(Object.values(all));
      }
      res.json([]);
    } catch (err) {
      res.status(500).json({ status: "error", message: err.message });
    }
  });

  app.get("/api/users", checkAuth, async (req, res) => {
    try {
      if (global.ST.DB && global.ST.DB.users) {
        const all = await global.ST.DB.users.getAll();
        return res.json(Object.values(all));
      }
      res.json([]);
    } catch (err) {
      res.status(500).json({ status: "error", message: err.message });
    }
  });

  app.post("/api/users/ban", checkAuth, async (req, res) => {
    try {
      const { uid, isBan, reason } = req.body;
      if (!uid) return res.status(400).json({ status: "error", message: "Missing uid" });
      if (global.ST.DB && global.ST.DB.users) {
        await global.ST.DB.users.set(uid, { isBan: !!isBan, banReason: reason || "" });
        return res.json({ status: "success", message: `User ban status updated to ${!!isBan}` });
      }
      res.status(400).json({ status: "error", message: "Database not ready" });
    } catch (err) {
      res.status(500).json({ status: "error", message: err.message });
    }
  });

  app.get("/api/commands", checkAuth, (req, res) => {
    try {
      const list = [];
      if (global.ST.cmds) {
        global.ST.cmds.forEach((val, key) => {
          list.push({ name: key, config: val.config || {} });
        });
      }
      res.json(list);
    } catch (err) {
      res.status(500).json({ status: "error", message: err.message });
    }
  });

  app.get("/api/commands/code", checkAuth, (req, res) => {
    try {
      const { name } = req.query;
      if (!name) return res.status(400).json({ status: "error", message: "Missing command name" });

      const CMDS_DIR = path.resolve(process.cwd(), "scripts/cmds");
      let filename = `${name.toLowerCase()}.js`;

      const files = fs.readdirSync(CMDS_DIR).filter(f => f.endsWith(".js"));
      for (const file of files) {
        if (file.toLowerCase() === `${name.toLowerCase()}.js`) {
          filename = file;
          break;
        }
        try {
          const content = fs.readFileSync(path.join(CMDS_DIR, file), "utf8");
          if (content.includes(`name: '${name}'`) || content.includes(`name: "${name}"`) ||
              content.includes(`name: "${name.toLowerCase()}"`) || content.includes(`name: '${name.toLowerCase()}'`)) {
            filename = file;
            break;
          }
        } catch (_) {}
      }

      const filePath = path.join(CMDS_DIR, filename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ status: "error", message: `Command script not found: ${filename}` });
      }

      const code = fs.readFileSync(filePath, "utf8");
      res.json({ status: "success", code, filename });
    } catch (err) {
      res.status(500).json({ status: "error", message: err.message });
    }
  });

  app.post("/api/commands/code", checkAuth, async (req, res) => {
    try {
      const { name, code } = req.body;
      if (!name) return res.status(400).json({ status: "error", message: "Missing command name" });
      if (code === undefined) return res.status(400).json({ status: "error", message: "Missing command code" });

      const CMDS_DIR = path.resolve(process.cwd(), "scripts/cmds");
      let filename = `${name.toLowerCase()}.js`;

      const files = fs.readdirSync(CMDS_DIR).filter(f => f.endsWith(".js"));
      for (const file of files) {
        if (file.toLowerCase() === `${name.toLowerCase()}.js`) {
          filename = file;
          break;
        }
        try {
          const content = fs.readFileSync(path.join(CMDS_DIR, file), "utf8");
          if (content.includes(`name: '${name}'`) || content.includes(`name: "${name}"`) ||
              content.includes(`name: "${name.toLowerCase()}"`) || content.includes(`name: '${name.toLowerCase()}'`)) {
            filename = file;
            break;
          }
        } catch (_) {}
      }

      const filePath = path.join(CMDS_DIR, filename);
      fs.writeFileSync(filePath, code, "utf8");

      try {
        if (global.reloadCmd && global.ST.api) {
          await global.reloadCmd(filename, global.ST.api);
        }
        res.json({ status: "success", message: `Command '${name}' saved and reloaded successfully ✓` });
      } catch (reloadErr) {
        res.json({
          status: "success",
          warning: reloadErr.message || String(reloadErr),
          message: `Saved file ${filename}, but reload failed: ${reloadErr.message || String(reloadErr)}`
        });
      }
    } catch (err) {
      res.status(500).json({ status: "error", message: err.message });
    }
  });

  app.get("/api/config", checkAuth, (req, res) => {
    try {
      const configPath = path.resolve(process.cwd(), "config.json");
      const configData = JSON.parse(fs.readFileSync(configPath, "utf8"));
      res.json(configData);
    } catch (err) {
      res.status(500).json({ status: "error", message: err.message });
    }
  });

  app.post("/api/config", checkAuth, (req, res) => {
    try {
      const configPath = path.resolve(process.cwd(), "config.json");
      const newConfig = req.body.config;
      if (!newConfig) return res.status(400).json({ status: "error", message: "Missing config data" });
      
      fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), "utf8");
      global.ST.config = newConfig;
      res.json({ status: "success", message: "Configuration saved successfully" });
    } catch (err) {
      res.status(500).json({ status: "error", message: err.message });
    }
  });

  app.post("/api/restart", checkAuth, (req, res) => {
    res.json({ status: "success", message: "Bot is restarting..." });
    log.warn("DASHBOARD", "Restart request received — exiting process in 1s…");
    setTimeout(() => {
      process.exit(2);
    }, 1000);
  });

  app.post("/api/session", checkAuth, async (req, res) => {
    const { sessionID } = req.body;
    if (!sessionID) return res.status(400).json({ status: "error", message: "Missing sessionID" });

    res.json({ status: "success", message: "Session ID injected! Bot is restarting to apply session…" });
    log.warn("DASHBOARD", "Session injection received — updating config.json and restarting…");

    try {
      // 1. Clear existing auth folder
      const authFolder = path.resolve(process.cwd(), cfg.authFolder || "./auth");
      if (fs.existsSync(authFolder)) {
        fs.rmSync(authFolder, { recursive: true, force: true });
        log.info("DASHBOARD", "Auth folder cleared for fresh session");
      }

      // 2. Save sessionID inside config.json
      const configPath = path.resolve(process.cwd(), "config.json");
      const configData = JSON.parse(fs.readFileSync(configPath, "utf8"));
      configData.sessionID = sessionID.trim();
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), "utf8");
      
      // Update global configuration
      global.ST.config.sessionID = sessionID.trim();

      // 3. Restart process
      setTimeout(() => {
        process.exit(2);
      }, 1000);
    } catch (err) {
      log.err("DASHBOARD", "Session injection failed: " + err.message);
    }
  });

  // WhatsApp Linker Proxy Routes (Pair_Code-main integration)
  app.get("/pair-device", (req, res) => {
    const pairHtml = path.resolve(process.cwd(), "dashboard", "pair", "pair.html");
    if (fs.existsSync(pairHtml)) {
      res.sendFile(pairHtml);
    } else {
      res.status(404).send("Linker page not found");
    }
  });

  app.use("/pair", pairRouter);
  app.use("/qr", qrRouter);

  // Setup Socket.IO on the same server
  const socketSetup = module.exports._socketSetup;
  await socketSetup(server);

  // Hook console to capture standard output logs
  hookConsole();

  await new Promise((resolve, reject) => {
    server.listen(port, (err) => {
      if (err) return reject(err);
      _server = server;
      log.success("STEP 5", `Express + Socket.IO running on port ${port}`);
      resolve();
    });
  });
}

/**
 * Original socket.io setup — attaches to an existing http.Server.
 */
async function _socketSetup(server) {
  const log = getLog();
  const cfg = (global.ST && global.ST.config && global.ST.config.serverUptime &&
               global.ST.config.serverUptime.socket) || {};
  const channelName = cfg.channelName || "uptime";
  
  // Use config.express.secretToken or serverUptime.socket.verifyToken or "Romeo"
  const verifyToken = (global.ST && global.ST.config && global.ST.config.express && global.ST.config.express.secretToken) ||
                      cfg.verifyToken || "Romeo";

  let io;
  try {
    io = new Server(server, { cors: { origin: "*" } });
    _io = io;
    if (global.ST) global.ST.io = io;
    log.info("SOCKET.IO", `Listening — channel="${channelName}"`);
  } catch (err) {
    return log.err("SOCKET.IO", `Init failed: ${err && err.message ? err.message : err}`);
  }

  io.on("connection", (socket) => {
    const token = (socket.handshake.auth && socket.handshake.auth.verifyToken) ||
                  (socket.handshake.query && socket.handshake.query.verifyToken);
                  
    if (token !== verifyToken) {
      socket.emit("auth_error", { status: "error", message: "Token is invalid" });
      socket.disconnect();
      return;
    }
    
    log.info("SOCKET.IO", `Client connected: ${socket.id}`);
    socket.emit("auth_success", { status: "success", message: "Connected to server successfully" });

    // Stream previous logs history immediately
    socket.emit("log_history", logHistory);

    const sendStats = async () => {
      try {
        const cpu = await getCpuUsage();
        socket.emit(channelName, {
          status: "ok",
          uptime: process.uptime(),
          memory: {
            rss: process.memoryUsage().rss,
            heapUsed: process.memoryUsage().heapUsed,
            heapTotal: process.memoryUsage().heapTotal,
          },
          cpu: cpu,
          ts: Date.now(),
        });
      } catch (_) {}
    };

    // Send initial status immediately on connection
    sendStats();

    const tick = setInterval(sendStats, 5000);

    socket.on("disconnect", () => {
      clearInterval(tick);
      log.info("SOCKET.IO", `Client disconnected: ${socket.id}`);
    });
  });
}

function getIO()     { return _io; }
function getServer() { return _server; }

module.exports = startExpress;
module.exports.startExpress  = startExpress;
module.exports._socketSetup  = _socketSetup;
module.exports.getIO         = getIO;
module.exports.getServer     = getServer;

