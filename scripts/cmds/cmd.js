"use strict";

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const {
  loadCmd,
  unloadCmd,
  reloadCmd,
  loadEvent,
  unloadEvent,
  reloadEvent,
} = require("../../bot/login/loadScripts.js");

const CMDS_DIR = path.resolve(__dirname);
const EVENTS_DIR = path.resolve(__dirname, "../events");

// ─── helpers ──────────────────────────────────────────────────────────────────

function clearCache(filePath) {
  try { delete require.cache[require.resolve(filePath)]; } catch (_) { }
}

/**
 * Validate that a loaded module has the correct GoatBot structure.
 * Accepts: { config: { name } } + onStart / onChat / onEvent handler
 */
function isValidMod(mod) {
  if (!mod || typeof mod !== "object") return false;
  if (!mod.config || typeof mod.config.name !== "string") return false;
  return (
    typeof mod.onStart === "function" ||
    typeof mod.onChat === "function" ||
    typeof mod.onEvent === "function" ||
    typeof mod.onLoad === "function"
  );
}

// ─── Shared install helper ────────────────────────────────────────────────────
async function installFile({ api, message, filePath, fileName, code }) {
  try {
    fs.writeFileSync(filePath, code, "utf8");
  } catch (err) {
    return message.reply(`❌ Failed to write file.\nReason: ${err.message}`);
  }

  try {
    clearCache(filePath);
    const mod = require(filePath);

    if (!isValidMod(mod)) {
      fs.unlinkSync(filePath);
      return message.reply(
        "❌ Invalid command structure.\n" +
        "Make sure the file exports `{ config: { name }, onStart }`."
      );
    }

    global.GoatBot.cmds.set(mod.config.name.toLowerCase(), mod);

    if (typeof mod.onLoad === "function") {
      await mod.onLoad({ api, threadsData: global.GoatBot.DB?.threads, userData: global.GoatBot.DB?.users }).catch(() => { });
    }

    return message.reply(
      `✅ Command *${mod.config.name}* installed & loaded!\n` +
      `📁 File: scripts/cmds/${fileName}`
    );
  } catch (err) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return message.reply(`❌ Failed to load installed command.\nReason: ${err.message}`);
  }
}


module.exports = {
  config: {
    name: "cmd",
    aliases: ["command"],
    version: "2.0.0",
    author: "Rômeo",
    countDown: 3,
    role: 3,
    shortDescription: "Manage commands: install, loadall, load, unload, reload",
    longDescription: "Install commands from a URL or raw code, and dynamically load/unload/reload them without restarting the bot.",
    category: "admin",
    guide: {
      en: [
        "{pn} install <file.js> <raw_url>   — install from URL",
        "{pn} install <file.js>             — install from quoted/replied code",
        "{pn} loadall                       — reload every command file",
        "{pn} load   <name>                 — load / enable a command",
        "{pn} unload <name>                 — unload / disable a command",
        "{pn} reload <name>                 — reload a command",
      ].join("\n")
    }
  },

  onStart: async ({ api, event, args, message }) => {
    const sub = (args[0] || "").toLowerCase();
    const target = args[1] || "";

    if (!sub) {
      return message.reply(
        "📦 *CMD Manager*\n\n" +
        "Subcommands:\n" +
        "  • install <file.js> [url]\n" +
        "  • loadall\n" +
        "  • load   <name>\n" +
        "  • unload <name>\n" +
        "  • reload <name>"
      );
    }

    // ════════════════════════════════════════════════════════════════════════
    // INSTALL
    // ════════════════════════════════════════════════════════════════════════
    if (sub === "install") {
      const fileName = target;
      if (!fileName || !fileName.endsWith(".js")) {
        return message.reply(
          "❌ Usage:\n" +
          "  !cmd install <filename.js> <raw_url>\n" +
          "  !cmd install <filename.js>   (then paste code in same message or reply)"
        );
      }

      const rawArg = args[2];
      let code;

      if (rawArg && /^https?:\/\//i.test(rawArg)) {
        await message.react("⏳");
        try {
          const res = await axios.get(rawArg, { timeout: 15000 });
          code = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
        } catch (err) {
          return message.reply(`❌ Failed to fetch URL.\nReason: ${err.message}`);
        }
      }

      if (!code) {
        const raw =
          event.body ||
          event.message?.conversation ||
          event.message?.extendedTextMessage?.text ||
          event.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation ||
          "";

        const idx = raw.indexOf(fileName);
        if (idx !== -1) {
          code = raw.slice(idx + fileName.length).trim();
        }

        if (!code) {
          return message.reply(
            "❌ No code found.\n" +
            "Either provide a raw URL as the 3rd argument, or include the code in the same message after the filename."
          );
        }
      }

      const filePath = path.join(CMDS_DIR, fileName);
      if (fs.existsSync(filePath)) {
        const warn = await message.reply(
          `⚠️ | The command file already exists, are you sure you want to overwrite the old command file?\nReact to this message to continue`
        );
        if (warn?.messageID) {
          global.GoatBot.onReaction.set(warn.messageID, {
            commandName: "cmd",
            author: event.senderID,
            type: "install_overwrite",
            filePath,
            fileName,
            code,
            api,
          });
        }
        return;
      }

      return installFile({ api, message, filePath, fileName, code });
    }

    // ════════════════════════════════════════════════════════════════════════
    // LOADALL — reload every .js file in scripts/cmds/
    // ════════════════════════════════════════════════════════════════════════
    if (sub === "loadall") {
      await message.react("⏳");

      const files = fs.readdirSync(CMDS_DIR).filter(f => f.endsWith(".js"));
      let loaded = 0, failed = 0;
      const errors = [];

      for (const file of files) {
        const filePath = path.join(CMDS_DIR, file);
        try {
          clearCache(filePath);
          const mod = require(filePath);
          if (!isValidMod(mod)) {
            errors.push(`⚠️ ${file}: invalid structure`);
            failed++;
            continue;
          }
          global.GoatBot.cmds.set(mod.config.name.toLowerCase(), mod);
          if (typeof mod.onLoad === "function") {
            await mod.onLoad({ api, threadsData: global.GoatBot.DB?.threads, userData: global.GoatBot.DB?.users }).catch(() => { });
          }
          loaded++;
        } catch (err) {
          errors.push(`❌ ${file}: ${err.message}`);
          failed++;
        }
      }

      await message.react(failed === 0 ? "✅" : "⚠️");

      let reply = `📦 *LoadAll complete*\n✅ Loaded: ${loaded}  |  ❌ Failed: ${failed}`;
      if (errors.length) reply += "\n\n" + errors.slice(0, 10).join("\n");
      return message.reply(reply);
    }

    // ════════════════════════════════════════════════════════════════════════
    // LOAD — load a single command (file must already exist in scripts/cmds/)
    // ════════════════════════════════════════════════════════════════════════
    if (sub === "load") {
      if (!target) return message.reply("❌ Usage: !cmd load <commandname>");

      try {
        const mod = await loadCmd(target, api);
        await message.react("✅");
        return message.reply(`✅ Command *${mod.config.name}* loaded.`);
      } catch (err) {
        await message.react("❌");
        return message.reply(`❌ Failed to load *${target}*.\nReason: ${err.message}`);
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // UNLOAD — remove command from memory (does NOT delete the file)
    // ════════════════════════════════════════════════════════════════════════
    if (sub === "unload") {
      if (!target) return message.reply("❌ Usage: !cmd unload <commandname>");

      try {
        unloadCmd(target);
        await message.react("✅");
        return message.reply(`✅ Command *${target}* unloaded from memory.\n💡 File is still on disk. Use !cmd load ${target} to re-enable.`);
      } catch (err) {
        await message.react("❌");
        return message.reply(`❌ Failed to unload *${target}*.\nReason: ${err.message}`);
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // RELOAD — unload + reload a single command
    // ════════════════════════════════════════════════════════════════════════
    if (sub === "reload") {
      if (!target) return message.reply("❌ Usage: !cmd reload <commandname>");

      try {
        const mod = await reloadCmd(target, api);
        await message.react("✅");
        return message.reply(`✅ Command *${mod.config.name}* reloaded.`);
      } catch (err) {
        await message.react("❌");
        return message.reply(`❌ Failed to reload *${target}*.\nReason: ${err.message}`);
      }
    }

    return message.reply(
      "❌ Unknown subcommand: *" + sub + "*\n" +
      "Valid: install | loadall | load | unload | reload"
    );
  },

  // ── Reaction handler — confirm overwrite ──────────────────────────────────
  onReaction: async ({ api, event, Reaction, message }) => {
    if (event.senderID !== Reaction.author) return;
    if (Reaction.type !== "install_overwrite") return;

    const { filePath, fileName, code } = Reaction;
    return installFile({ api, message, filePath, fileName, code });
  },
};
