"use strict";

const os = require("os");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const express = require("express");





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
    const drive = path.resolve(process.cwd()).substring(0, 2);
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

let cachedCpu = 0;
let cachedStorage = { size: 500 * 1024 * 1024 * 1024, free: 250 * 1024 * 1024 * 1024 };
let cachedDb = { threads: 0, users: 0, members: 0 };

async function updateDbMetrics() {
  if (global.GoatBot && global.GoatBot.DB) {
    let threads = 0;
    let users = 0;
    let members = 0;

    if (global.GoatBot.DB.threads) {
      threads = await global.GoatBot.DB.threads.count();
      try {
        const allThreads = await global.GoatBot.DB.threads.getAll();
        for (const tid in allThreads) {
          members += allThreads[tid].totalMember || 0;
        }
      } catch (_) { }
    }
    if (global.GoatBot.DB.users) {
      users = await global.GoatBot.DB.users.count();
    }

    cachedDb = { threads, users, members };
  }
}

function startMetricCaching() {
  // Update CPU every 5 seconds
  setInterval(async () => {
    try {
      cachedCpu = await getCpuUsage();
    } catch (_) { }
  }, 5000);

  // Update storage every 60 seconds
  setInterval(async () => {
    try {
      cachedStorage = await getStorageInfo();
    } catch (_) { }
  }, 60000);

  // Update DB stats every 10 seconds
  setInterval(async () => {
    try {
      await updateDbMetrics();
    } catch (_) { }
  }, 10000);

  // Initial trigger
  getCpuUsage().then(cpu => { cachedCpu = cpu; }).catch(() => { });
  getStorageInfo().then(storage => { cachedStorage = storage; }).catch(() => { });
  updateDbMetrics().catch(() => { });
}

let packageVersion = "1.0.0";
let depCount = 0;
try {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"));
  packageVersion = pkg.version || "1.0.0";
  depCount = Object.keys(pkg.dependencies || {}).length + Object.keys(pkg.devDependencies || {}).length;
} catch (_) { }

function checkAuth(req, res, next) {
  const cfg = global.GoatBot && global.GoatBot.config;
  const token = cfg && cfg.express && cfg.express.secretToken ? cfg.express.secretToken : "Romeo";

  const authHeader = req.headers.authorization;
  const reqToken = req.query.token || (authHeader && authHeader.split(" ")[1]) || req.body.token;

  if (reqToken !== token) {
    return res.status(401).json({ status: "error", message: "Unauthorized: Invalid token" });
  }
  next();
}

let _log = null;
function getLog() {
  if (_log) return _log;
  try { _log = require("../logger/log.js"); } catch (_) { }
  if (!_log) {
    _log = {
      info: (tag, ...a) => console.log(`[INFO] ${tag}:`, ...a),
      err: (tag, ...a) => console.log(`[ERR]  ${tag}:`, ...a),
      warn: (tag, ...a) => console.log(`[WARN] ${tag}:`, ...a),
      success: (tag, ...a) => console.log(`[DONE] ${tag}:`, ...a),
    };
  }
  return _log;
}

async function startDashboard(app, io) {
  const log = getLog();
  const cfg = global.GoatBot && global.GoatBot.config;

  // Start background caching for CPU/Storage metrics
  startMetricCaching();

  // Serve static files from dashboard folder
  const dashboardDir = path.resolve(process.cwd(), "dashboard");
  if (!fs.existsSync(dashboardDir)) {
    fs.mkdirSync(dashboardDir, { recursive: true });
  }
  app.use("/dashboard", express.static(dashboardDir));

  // Authenticated APIs
  app.get("/api/metrics", checkAuth, async (req, res) => {
    try {
      const cpu = cachedCpu;
      const storage = cachedStorage;
      const { threads, users, members } = cachedDb;

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
        commands: global.GoatBot.cmds ? global.GoatBot.cmds.size : 0,
        events: global.GoatBot.events ? global.GoatBot.events.size : 0,
      });
    } catch (err) {
      res.status(500).json({ status: "error", message: err.message });
    }
  });

  app.get("/api/threads", checkAuth, async (req, res) => {
    try {
      if (global.GoatBot.DB && global.GoatBot.DB.threads) {
        const all = await global.GoatBot.DB.threads.getAll();
        return res.json(Object.values(all));
      }
      res.json([]);
    } catch (err) {
      res.status(500).json({ status: "error", message: err.message });
    }
  });

  app.get("/api/users", checkAuth, async (req, res) => {
    try {
      if (global.GoatBot.DB && global.GoatBot.DB.users) {
        const all = await global.GoatBot.DB.users.getAll();
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
      if (global.GoatBot.DB && global.GoatBot.DB.users) {
        await global.GoatBot.DB.users.set(uid, { isBan: !!isBan, banReason: reason || "" });
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
      if (global.GoatBot.cmds) {
        global.GoatBot.cmds.forEach((val, key) => {
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
        } catch (_) { }
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
        } catch (_) { }
      }

      const filePath = path.join(CMDS_DIR, filename);
      fs.writeFileSync(filePath, code, "utf8");

      try {
        if (global.reloadCmd && global.GoatBot.api) {
          await global.reloadCmd(filename, global.GoatBot.api);
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
      global.GoatBot.config = newConfig;
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
      const authFolder = path.resolve(process.cwd(), cfg.authFolder || "./auth");
      if (fs.existsSync(authFolder)) {
        fs.rmSync(authFolder, { recursive: true, force: true });
        log.info("DASHBOARD", "Auth folder cleared for fresh session");
      }

      const configPath = path.resolve(process.cwd(), "config.json");
      const configData = JSON.parse(fs.readFileSync(configPath, "utf8"));
      configData.sessionID = sessionID.trim();
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), "utf8");

      global.GoatBot.config.sessionID = sessionID.trim();

      setTimeout(() => {
        process.exit(2);
      }, 1000);
    } catch (err) {
      log.err("DASHBOARD", "Session injection failed: " + err.message);
    }
  });

  app.post("/api/logs/clear", checkAuth, (req, res) => {
    try {
      const logger = require("../logger/log.js");
      if (logger && typeof logger.clearHistory === "function") {
        logger.clearHistory();
      }
      // Broadcast to all clients to clear their screen
      io.emit("console_log_clear");
      res.json({ status: "success", message: "Console log history cleared in backend" });
    } catch (err) {
      res.status(500).json({ status: "error", message: err.message });
    }
  });

  io.on("connection", (socket) => {
    socket.emit("log_history", log.getHistory ? log.getHistory() : []);
  });

  log.success("DASHBOARD", "Dashboard backend endpoints initialized");
}

module.exports = { startDashboard };
