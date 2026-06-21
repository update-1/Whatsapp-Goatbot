"use strict";

// Resolve a member's display name, falling back to getUserInfo for new members
async function getMemberName(api, uid, userData) {
  // 1. Try local DB / contacts first
  let name = await global.resolveUserDisplayName(api, uid, userData).catch(() => "");

  // 2. If we only got a bare phone number, try the live API
  const bare = uid.split("@")[0].split(":")[0];
  if (!name || name === bare || /^\d+$/.test(name)) {
    try {
      const info = await api.getUserInfo(uid);
      // getUserInfo may return an object keyed by JID, or an array
      const entry = Array.isArray(info) ? info[0] : (info && (info[uid] || Object.values(info)[0]));
      const fetched = entry?.name || entry?.pushName || entry?.notify || "";
      if (fetched) name = fetched;
    } catch (_) { }
  }

  return name || bare || uid;
}

module.exports = {
  config: {
    name: "welcome",
    version: "1.0.0",
    author: "Rômeo",
    category: "events"
  },

  onStart: async ({ api, event, threadsData, userData }) => {
    if (event.logMessageType !== "log:subscribe") return;
    if (!event.isGroup && event.type !== "event") return;

    const { threadID, participants, isBotAdded } = event;
    if (!threadID) return;

    // If the bot itself was added — greet the group
    if (isBotAdded) {
      const cfg = global.GoatBot.config;
      const prefix = cfg.prefix || "!";
      const name = cfg.botName || "WCA Bot";
      return api.sendMessage(
        `👋 *Hello everyone!*\nI'm *${name}*, your new assistant bot.\n\nType ${prefix}help to see all available commands.`,
        threadID
      );
    }

    // Welcome new members
    const added = Array.isArray(participants) ? participants : [];
    if (added.length === 0) return;

    let thread = null;
    try { thread = await threadsData(threadID); } catch (_) { }
    const groupName = (thread && thread.name) || "this group";

    for (const uid of added) {
      const name = await getMemberName(api, uid, userData);
      // bare phone number for @mention display (e.g. "262023791247378")
      const phone = uid.split("@")[0].split(":")[0];
      try {
        await api.sendMessage(
          {
            body: `👋 Welcome @${phone} to *${groupName}*!\n\nHope you enjoy your stay 🎉`,
            mentions: [uid],
          },
          threadID
        );
      } catch (_) { }
    }
  }
};
