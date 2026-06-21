"use strict";

module.exports = {
  config: {
    name: "rankup",
    version: "1.0.0",
    author: "Rômeo",
    role: 0,
    shortDescription: "Toggle rankup notifications",
    longDescription: "Turn on or turn off level up notifications for the group.",
    category: "utility",
    guide: { en: "{pn} [on/off]" }
  },

  langs: {
    en: {
      turnedOn: "✅ Turned on level up notification",
      turnedOff: "❌ Turned off level up notification",
      notiMessage: "🎉🎉 Congratulations on reaching level %1"
    }
  },

  onStart: async ({ api, event, args, message, threadsData }) => {
    try {
      const getLang = (key) => module.exports.langs.en[key];
      const thread = await threadsData(event.threadID);
      let isRankupOn = thread.data && thread.data.rankup === true;

      if (args[0] === "on") {
        isRankupOn = true;
      } else if (args[0] === "off") {
        isRankupOn = false;
      } else {
        isRankupOn = !isRankupOn;
      }

      if (!thread.data) thread.data = {};
      thread.data.rankup = isRankupOn;

      if (global.GoatBot && global.GoatBot.DB && global.GoatBot.DB.threads) {
        await global.GoatBot.DB.threads.set(event.threadID, { data: thread.data });
      }

      if (isRankupOn) {
        return message.reply(getLang("turnedOn"));
      } else {
        return message.reply(getLang("turnedOff"));
      }
    } catch (e) {
      return message.reply("❌ Error: " + e.message);
    }
  },

  onChat: async ({ api, event, message, userData, threadsData }) => {
    if (!event.isGroup) return;

    try {
      const thread = await threadsData(event.threadID);
      if (!thread.data || thread.data.rankup !== true) return;

      const u = await userData(event.senderID);
      const msgCount = u.msgCount || 0;

      if (msgCount <= 0) return;

      const currentLevel = Math.floor(Math.sqrt(msgCount / 5));
      const previousLevel = Math.floor(Math.sqrt((msgCount - 1) / 5));

      if (currentLevel > previousLevel && currentLevel > 0) {
        const getLang = (key) => module.exports.langs.en[key];
        const notiMsg = getLang("notiMessage").replace("%1", currentLevel);

        let displayName = event.senderName || event.pushName;
        if (!displayName) {
          try {
            const sock = api.ctx ? api.ctx.sock : null;
            if (sock && sock.contacts && sock.contacts[event.senderID]) {
              const c = sock.contacts[event.senderID];
              displayName = c.notify || c.name || c.verifiedName;
            }
          } catch (e) { }
        }
        if (!displayName) {
          displayName = u.name !== "Unknown" ? u.name : "+" + event.senderID.split("@")[0].split(":")[0];
        }

        // Send congratulation message tagging them
        await message.reply(`👤 *${displayName}*\n${notiMsg}`);
      }
    } catch (e) { }
  }
};
