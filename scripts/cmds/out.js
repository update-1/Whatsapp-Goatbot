"use strict";

module.exports = {
  config: {
    name: "out",
    aliases: ["leave"],
    version: "1.0.0",
    author: "Romeo",
    countDown: 5,
    role: 2,
    shortDescription: "Make bot leave the group",
    longDescription: "Forces the bot to leave the current group or a specified group. Only Bot Admins can use this.",
    category: "owner",
    guide: { en: "{pn} [threadID]" }
  },

  onStart: async function ({ api, event, args, message }) {
    const threadID = args[0] || event.threadID;

    if (!threadID.endsWith("@g.us")) {
       return message.reply("❌ This command can only be used in groups!");
    }

    try {
      await message.reply("👋 Goodbye everyone! The bot is leaving the group...");
      await api.leaveGroup(threadID);
    } catch (e) {
      return message.reply("❌ Failed to leave the group: " + e.message);
    }
  }
};
