"use strict";

const a = require("axios");
const f = require("fs");

const removeHomeDir = (str) => {
  if (typeof str !== "string") return str;
  const homeDir = process.env.HOME || process.env.USERPROFILE || "/home";
  return str.replace(new RegExp(homeDir.replace(/\\/g, "\\\\"), "g"), "~");
};

function mapToObj(map) {
  const obj = {};
  map.forEach((v, k) => { obj[k] = v; });
  return obj;
}

module.exports = {
  config: {
    name: "eval",
    aliases: ["ev"],
    version: "4.1",
    author: "Rômeo",
    countDown: 0,
    role: 3,
    shortDescription: "Execute JavaScript code",
    longDescription: "Evaluate arbitrary JavaScript code. Developer-only (role 3).",
    category: "developer",
    guide: {
      en: "{pn} <code>"
    }
  },

  onStart: async ({ api, event, args, message, threadsData, userData }) => {
    // ── Validate input ────────────────────────────────────────────────────────
    const code = args.join(" ").trim();
    if (!code) {
      return message.reply("⚠️ Please provide code to execute.\nUsage: eval <code>");
    }

    // ── Output helper ─────────────────────────────────────────────────────────
    async function out(output) {
      let text = output;
      if (typeof text === "number" || typeof text === "boolean" || typeof text === "function") {
        text = text.toString();
      } else if (text instanceof Map) {
        text = `Map(${text.size}) ` + JSON.stringify(mapToObj(text), null, 2);
      } else if (typeof text === "object" && text !== null) {
        try {
          text = JSON.stringify(text, null, 2);
        } catch (_) {
          text = "[Object with circular reference]";
        }
      } else if (typeof text === "undefined" || text === null) {
        text = "undefined";
      }
      return await message.reply(text);
    }

    // ── Execute ───────────────────────────────────────────────────────────────
    try {
      const evalFunc = new Function(
        "a", "f", "api", "event", "args", "message",
        "threadsData", "userData", "out",
        `return (async () => {
          try {
            const fas = f.readFileSync;
            ${(code.includes("return") || code.includes("const ") || code.includes("let ") || code.includes(";")) ? code : "return " + code};
          } catch (innerErr) {
            throw innerErr;
          }
        })();`
      );

      const evalResult = await Promise.race([
        evalFunc(
          a, f, api, event, args, message,
          threadsData, userData, out
        ),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("⏰ Code execution timed out after 5 seconds.")), 5000)
        )
      ]);

      if (typeof evalResult !== "undefined") {
        await out(evalResult);
      }
    } catch (err) {
      const errorMessage =
        `❌ An error occurred:\n\`\`\`\n${removeHomeDir(err.stack || err.toString())}\n\`\`\``;
      await message.reply(errorMessage).catch(() => { });
    }
  }
};
