"use strict";

module.exports = {
  config: {
    name: "refresh",
    aliases: ["update", "sync"],
    version: "1.0.0",
    author: "Rômeo",
    role: 1, // Requires Group Admin
    shortDescription: "Refresh database data",
    longDescription: "Refreshes the database for the current group (fetching latest members, group picture, admins) or a specific user if replied to.",
    category: "admin",
    guide: { en: "{pn} | {pn} [reply to user]" }
  },

  onStart: async ({ api, event, message, threadsData, userData }) => {
    try {
      await message.react("⏳");

      const replied = event.messageReply || event.replyToMessage;

      // 1. Refresh User Data (if replying to someone)
      if (replied) {
        const uid = replied.senderID;
        const u = await userData(uid); // Ensure they exist in DB

        let pfp = null;
        try {
          pfp = await global.GoatBot.DB.userData.getAvatarUrl(api, uid);
        } catch (e) { }

        let newName = null;
        try {
          const sock = api.ctx ? api.ctx.sock : null;
          if (sock && sock.contacts && sock.contacts[uid]) {
            const c = sock.contacts[uid];
            newName = c.notify || c.name || c.verifiedName;
          }
        } catch (e) { }

        const updateObj = {};
        if (newName) updateObj.name = newName;
        if (pfp) updateObj.pfp = pfp;

        if (Object.keys(updateObj).length > 0) {
          if (global.GoatBot && global.GoatBot.DB && global.GoatBot.DB.users) {
            await global.GoatBot.DB.users.set(uid, updateObj);
          }
        }

        await message.react("✅");
        return message.reply(`✅ Refreshed data for ${newName || "+" + uid.split('@')[0]}.\nProfile Picture: ${pfp ? "Updated" : "Not Found"}`);
      }

      // 2. Refresh Group Data
      if (event.isGroup) {
        const meta = await api.ctx.sock.groupMetadata(event.threadID);

        if (global.GoatBot && global.GoatBot.DB && global.GoatBot.DB.threads) {
          // Updates names, members, and admins natively
          await global.GoatBot.DB.threads.refreshInfo(event.threadID, meta);
        }

        let pfp = null;
        try {
          pfp = await global.GoatBot.DB.userData.getAvatarUrl(api, event.threadID);
          if (pfp && global.GoatBot && global.GoatBot.DB && global.GoatBot.DB.threads) {
            await global.GoatBot.DB.threads.set(event.threadID, { pfp });
          }
        } catch (e) { }

        await message.react("✅");
        const adminCount = meta.participants ? meta.participants.filter(p => p.admin).length : 0;
        const memberCount = meta.participants ? meta.participants.length : 0;

        return message.reply(`✅ Group data refreshed successfully!\n\n*Name:* ${meta.subject}\n*Members:* ${memberCount}\n*Admins:* ${adminCount}\n*Group Picture:* ${pfp ? "Updated" : "Not Found"}`);
      } else {
        return message.reply("❌ Use this in a group, or reply to a user.");
      }

    } catch (err) {
      await message.react("❌");
      return message.reply("❌ Error refreshing data: " + err.message);
    }
  }
};
