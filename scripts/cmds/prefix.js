"use strict";


module.exports = {
  config: {
    name: "prefix",
    version: "1.0.0",
    author: "Rômeo",
    countDown: 3,
    role: 0,            // anyone can VIEW; SET/RESET checked inside onStart
    shortDescription: "View or set a custom prefix for this chat",
    longDescription: "Shows the active prefix for this group/DM. Admins can set a custom one or reset to global.",
    category: "system",
    guide: { en: "{pn} [new_prefix | reset]" },
  },

  onStart: async ({ event, args, message, threadsData }) => {
    const globalPrefix = global.GoatBot.config.prefix || "!";
    const chatType = event.isGroup ? "group" : "DM";
    const adminList = global.GoatBot.config.adminBot || [];
    const isAdmin = adminList.includes(event.senderID);

    // ── Show current prefix (anyone) ────────────────────────────────────────
    if (!args[0]) {
      const thread = await threadsData(event.threadID);
      const customPrefix = thread && thread.data && thread.data.prefix;
      const effective = customPrefix || globalPrefix;
      return message.reply(
        `📌 *Prefix — ${chatType}*\n` +
        `Global  : \`${globalPrefix}\`\n` +
        `This ${chatType}: \`${effective}\`` +
        (customPrefix
          ? `\n_(custom — use \`${effective}prefix reset\` to remove)_`
          : `\n_(using global)_`)
      );
    }

    // ── Set / reset — admins only ────────────────────────────────────────────
    if (!isAdmin) {
      return message.reply("⛔ Only admins can change the prefix.");
    }

    if (args[0].toLowerCase() === "reset") {
      const thread = await threadsData(event.threadID);
      const data = (thread && thread.data) ? { ...thread.data } : {};
      delete data.prefix;
      await global.GoatBot.DB.threads.set(event.threadID, data, "data");
      return message.reply(`✅ Prefix reset — using global: \`${globalPrefix}\``);
    }

    const newPrefix = args[0];
    if (newPrefix.length > 5) {
      return message.reply("❌ Prefix too long — max 5 characters.");
    }

    const thread = await threadsData(event.threadID);
    const data = (thread && thread.data) ? { ...thread.data } : {};
    data.prefix = newPrefix;
    await global.GoatBot.DB.threads.set(event.threadID, data, "data");
    return message.reply(
      `✅ Prefix for this ${chatType} set to: \`${newPrefix}\`\n` +
      `Global prefix remains: \`${globalPrefix}\``
    );
  },
  // onChat: allow typing "prefix" (without bot prefix) to show prefix info
  onChat: async ({ event, args, message, threadsData }) => {
    if ((event.body || "").trim().toLowerCase() !== "prefix") return;
    await module.exports.onStart({ event, args: [], message, threadsData });
    return true;
  },

};
