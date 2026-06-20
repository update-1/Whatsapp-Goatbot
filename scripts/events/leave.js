"use strict";

// Resolve a member's display name, falling back to getUserInfo
async function getMemberName(api, uid, userData) {
  let name = await global.resolveUserDisplayName(api, uid, userData).catch(() => "");
  const bare = uid.split("@")[0].split(":")[0];
  if (!name || name === bare || /^\d+$/.test(name)) {
    try {
      const info = await api.getUserInfo(uid);
      const entry = Array.isArray(info) ? info[0] : (info && (info[uid] || Object.values(info)[0]));
      const fetched = entry?.name || entry?.pushName || entry?.notify || "";
      if (fetched) name = fetched;
    } catch (_) { }
  }
  return name || bare || uid;
}

module.exports = {
  config: {
    name: "leave",
    version: "1.0.0",
    author: "Rômeo",
    category: "events"
  },

  onStart: async ({ api, event, threadsData, userData }) => {
    if (event.logMessageType !== "log:unsubscribe") return;
    if (!event.isGroup && event.type !== "event") return;

    const { threadID, participants, isBotRemoved } = event;
    if (!threadID) return;

    // If bot was removed — just log it
    if (isBotRemoved) return;

    const left = Array.isArray(participants) ? participants : [];
    if (left.length === 0) return;

    let thread = null;
    try { thread = await threadsData(threadID); } catch (_) { }
    const groupName = (thread && thread.name) || "the group";

    for (const uid of left) {
      const name = await getMemberName(api, uid, userData);
      const phone = uid.split("@")[0].split(":")[0];
      try {
        await api.sendMessage(
          {
            body: `👋 @${phone} has left ${groupName}. Goodbye! 👋`,
            mentions: [uid],
          },
          threadID
        );
      } catch (_) { }
    }
  }
};
