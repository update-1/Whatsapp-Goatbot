"use strict";
const { colors } = require("./colors.js");

const logHistory = [];
const MAX_LOGS = 200;

const originalLog = console.log;
console.log = function (...args) {
  originalLog.apply(console, args);
  const message = args.map(arg => {
    if (arg && typeof arg === "object") {
      try { return JSON.stringify(arg, null, 2); } catch (_) { return String(arg); }
    }
    return String(arg);
  }).join(" ");

  logHistory.push(message);
  if (logHistory.length > MAX_LOGS) logHistory.shift();

  if (global.GoatBot && global.GoatBot.io) {
    global.GoatBot.io.emit("console_log", message);
  }
};

let _moment;
try { _moment = require("moment-timezone"); } catch (_) { _moment = null; }

function getTime() {
  if (_moment) return _moment().tz("Asia/Dhaka").format("HH:mm:ss");
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function getDate() {
  if (_moment) return _moment().tz("Asia/Dhaka").format("DD/MM/YYYY");
  return new Date().toLocaleDateString("en-GB");
}

function stamp() {
  return colors.gray(`${getTime()} ${getDate()}`);
}

function getPrefixColor(prefix) {
  const p = String(prefix || "").toUpperCase();
  if (p === "VERSION" || p === "V" || p === "UPDATE") return colors.hex("#74b9ff");
  if (p === "CONFIG" || p === "SESSION" || p === "LOGIN" || p === "CONNECT") return colors.hex("#f5ab00");
  if (p === "DATABASE" || p === "SQLITE" || p === "DB") return colors.hex("#22d39a");
  if (p === "SCRIPTS" || p === "CMD" || p === "EVENT" || p === "AUTO LOAD") return colors.hex("#a29bfe");
  if (p === "EXPRESS" || p === "SOCKET" || p === "DASHBOARD") return colors.hex("#00cec9");
  if (p === "READY" || p === "SUCCESS" || p === "STEP 7" || p === "BOT ID") return colors.greenBright;
  if (p === "WARN" || p === "WARNING") return colors.yellowBright;
  if (p === "ERR" || p === "ERROR" || p === "FAIL") return colors.redBright;
  return colors.cyanBright;
}

function buildLine(level, colorFn, prefix, message) {
  if (message === undefined) { message = prefix; prefix = null; }
  if (!prefix) return `${stamp()}  ${message}`;
  const label = `${prefix}:`;
  const labelColor = colorFn || getPrefixColor(prefix);
  return `${stamp()}  ${labelColor(label)} ${message}`;
}

const log = {
  info(prefix, message) {
    console.log(buildLine("INFO", colors.cyanBright, prefix, message));
  },
  success(prefix, message) {
    console.log(buildLine("DONE", colors.greenBright, prefix, message));
  },
  warn(prefix, message) {
    console.log(buildLine("WARN", colors.yellowBright, prefix, message));
  },
  err(prefix, message, ...extra) {
    console.log(buildLine("ERR ", colors.redBright, prefix, message));
    for (const e of extra) {
      if (e && e.stack) console.log(colors.red("       " + e.stack));
      else if (typeof e === "object") console.log(colors.red("       " + JSON.stringify(e, null, 2)));
      else if (e !== undefined) console.log(colors.red("       " + e));
    }
  },
  error(...args) { this.err(...args); },
  master(prefix, message) {
    console.log(buildLine("BOT ", colors.hex.bind(null, "#f5a623"), prefix, message));
  },
  cmd(prefix, message) {
    console.log(buildLine("CMD ", colors.hex.bind(null, "#a29bfe"), prefix, message));
  },
  dev(...args) {
    try { throw new Error(); } catch (e) {
      const at = e.stack.split("\n")[2] || "";
      let pos = at.slice(at.indexOf(process.cwd()) + process.cwd().length + 1).replace(/\)$/, "");
      console.log(colors.hex("#74b9ff")(`[DEV] ${pos} =>`), ...args);
    }
  },
  divider(label = "") {
    const width = 70;
    if (label) {
      const text = ` ${label} `;
      const left = Math.max(0, Math.floor((width - text.length) / 2));
      const right = Math.max(0, width - left - text.length);
      const dividerLine = "─".repeat(left) + text + "─".repeat(right);
      console.log(colors.hex("#f5ab00")(dividerLine));
    } else {
      console.log(colors.hex("#f5ab00")("─".repeat(width)));
    }
  },
  banner(lines = []) {
    const width = 52;
    const border = colors.hex("#6c5ce7")("╔" + "═".repeat(width) + "╗");
    const empty = colors.hex("#6c5ce7")("║" + " ".repeat(width) + "║");
    const foot = colors.hex("#6c5ce7")("╚" + "═".repeat(width) + "╝");
    console.log(border);
    for (const line of lines) {
      const pad = Math.max(0, width - line.length);
      const left = Math.floor(pad / 2);
      const right = pad - left;
      console.log(colors.hex("#6c5ce7")("║") + " ".repeat(left) + line + " ".repeat(right) + colors.hex("#6c5ce7")("║"));
    }
    console.log(empty);
    console.log(foot);
  }
};

module.exports = log;
module.exports.getHistory = () => logHistory;
module.exports.clearHistory = () => { logHistory.length = 0; };