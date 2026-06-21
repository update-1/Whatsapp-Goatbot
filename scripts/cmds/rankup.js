"use strict";

// Same EXP formula as rank.js (GoatBot-V2 style)
const DELTA_NEXT = 5;
const expToLevel = (exp) => Math.floor((1 + Math.sqrt(1 + 8 * exp / DELTA_NEXT)) / 2);

module.exports = {
  config: {
    name: "rankup",
    version: "2.0.0",
    author: "Rômeo",
    role: 0,
    shortDescription: "Toggle rankup notifications",
    longDescription: "Turn on or turn off level up notifications for the group.",
    category: "utility",
    guide: { en: "{pn} [on/off]" }
  },

  langs: {
    en: {
      turnedOn: "✅ Level-up notifications turned ON for this group.",
      turnedOff: "❌ Level-up notifications turned OFF for this group.",
      notiMessage: "🎉🎉 Congratulations @{name} on reaching *Level {level}*!"
    }
  },

  // ── onStart: toggle rankup on/off for this thread ─────────────────────────
  onStart: async ({ event, args, message, threadsData }) => {
    try {
      const getLang = (key) => module.exports.langs.en[key];
      const thread = await threadsData(event.threadID);
      let isOn = thread.data && thread.data.rankup === true;

      if (args[0] === "on") isOn = true;
      else if (args[0] === "off") isOn = false;
      else isOn = !isOn; // toggle if no arg

      if (!thread.data) thread.data = {};
      thread.data.rankup = isOn;
      await global.GoatBot.DB.threads.set(event.threadID, { data: thread.data });

      return message.reply(isOn ? getLang("turnedOn") : getLang("turnedOff"));
    } catch (e) {
      return message.reply("❌ Error: " + e.message);
    }
  },

  // ── onChat: fire level-up message when user crosses a level ───────────────
  // Reads exp AFTER rank.js onChat has incremented it (+1 per message)
  onChat: async ({ api, event, message, userData, threadsData }) => {
    if (!event.isGroup) return;
    try {
      const thread = await threadsData(event.threadID);
      if (!thread.data || thread.data.rankup !== true) return;

      const u = await userData(event.senderID);
      const exp = typeof u.exp === 'number' && !isNaN(u.exp) ? u.exp : 0;
      if (exp <= 0) return;

      // Level after this message vs level before
      const currentLevel = expToLevel(exp);
      const previousLevel = expToLevel(exp - 1);

      if (currentLevel > previousLevel && currentLevel > 0) {
        const normUID = (jid) => {
          if (!jid) return "";
          if (Array.isArray(jid)) jid = jid[0];
          if (typeof jid !== "string") return "";
          return jid.split(":")[0].split("@")[0];
        };
        const num = normUID(event.senderID);

        // Resolve display name
        let displayName = event.senderName || event.pushName;
        if (!displayName) {
          try {
            const sock = api.ctx ? api.ctx.sock : null;
            if (sock && sock.contacts) {
              const c = sock.contacts[num + "@s.whatsapp.net"] || sock.contacts[num + "@lid"];
              if (c) displayName = c.notify || c.name || c.verifiedName;
            }
          } catch (_) { }
        }
        if (!displayName || displayName === "Unknown") {
          displayName = u.name !== "Unknown" ? u.name : "+" + num;
        }

        const msg = module.exports.langs.en.notiMessage
          .replace("{name}", displayName)
          .replace("{level}", currentLevel);

        await message.reply(msg);
      }
    } catch (_) { }
  }
};
