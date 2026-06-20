"use strict";

const axios = require('axios');

module.exports = {
  config: {
    name: "userinfo",
    aliases: ["ui", "info"],
    version: "1.0.0",
    author: "Rômeo",
    role: 0,
    shortDescription: "View user profile info",
    longDescription: "View profile info, message count, and profile picture of yourself or someone else (by tagging them or replying to their message).",
    category: "utility",
    guide: { en: "{pn} | {pn} @user | {pn} [reply to message]" }
  },

  onStart: async ({ api, event, message, threadsData, userData }) => {
    try {
      await message.react("⏳");

      // 1. Determine Target User
      let targetJid;
      const replied = event.messageReply || event.replyToMessage;

      if (replied) {
        targetJid = replied.senderID;
      } else if (event.mentions) {
        if (Array.isArray(event.mentions) && event.mentions.length > 0) {
          targetJid = event.mentions[0];
        } else if (Object.keys(event.mentions).length > 0) {
          targetJid = Object.keys(event.mentions)[0];
        } else {
          targetJid = event.senderID;
        }
      } else {
        targetJid = event.senderID;
      }

      // 2. Fetch User Data from Database
      const u = await userData(targetJid).catch(() => null);
      const msgCount = u ? (u.msgCount || u.exp || 0) : 0;
      const level = Math.floor(Math.sqrt(msgCount / 5));

      // 3. Resolve Display Name
      let displayName = null;
      if (targetJid === event.senderID) {
        displayName = event.senderName || event.pushName;
      }
      if (!displayName) {
        try {
          const sock = api.ctx ? api.ctx.sock : null;
          if (sock && sock.contacts && sock.contacts[targetJid]) {
            const c = sock.contacts[targetJid];
            displayName = c.notify || c.name || c.verifiedName;
          }
        } catch (e) { }
      }
      if (!displayName || String(displayName).match(/^\d+$/) || displayName === "Unknown") {
        displayName = u ? u.name : null;
      }
      if (!displayName || displayName === "Unknown") {
        displayName = "No Name Found";
      }

      // 4. Group Info (Role)
      let role = "Member";
      if (event.isGroup) {
        try {
          const thread = await threadsData(event.threadID);
          const isAdmin = thread.adminIDs && thread.adminIDs.includes(targetJid);
          if (isAdmin) role = "Group Admin 🛡️";
        } catch (e) { }
      }

      // 5. Fetch Profile Picture
      let buffer = null;
      try {
        const targetUrl = await userData.getAvatarUrl(api, targetJid);
        const res = await axios.get(targetUrl, { responseType: 'arraybuffer', timeout: 5000 });
        buffer = Buffer.from(res.data);
      } catch (e) { }

      const rawNumber = targetJid.split('@')[0].split(':')[0];
      const phoneNumber = "@" + rawNumber;

      // 6. Format Message
      const caption = `
👤 *USER INFORMATION*
━━━━━━━━━━━━━━━━━━
*Name:* ${displayName}
*Mention:* ${phoneNumber}

📊 *STATISTICS*
*Messages Sent:* ${msgCount.toLocaleString()}
*Current Level:* ${level}
*Role:* ${role}
      `.trim();

      await message.react("✅");

      if (buffer) {
        await api.sendImage(buffer, event.threadID, caption);
      } else {
        await message.reply(caption);
      }

    } catch (err) {
      await message.react("❌");
      await message.reply("❌ Error fetching user info: " + err.message);
    }
  }
};
