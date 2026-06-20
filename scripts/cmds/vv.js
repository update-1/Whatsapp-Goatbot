"use strict";

const { downloadMediaMessage } = require("@whiskeysockets/baileys");

module.exports = {
  config: {
    name: "vv",
    aliases: ["viewonce"],
    version: "1.0.0",
    author: "Rômeo",
    role: 0,
    shortDescription: "Save View Once media",
    longDescription: "Reply to a view-once (1-time view) image, video, or voice note to download and resend it permanently.",
    category: "media",
    guide: { en: "{pn} [reply to view-once media]" }
  },

  onStart: async ({ api, event, message }) => {
    try {
      const replied = event.messageReply || event.replyToMessage;

      if (!replied || !replied.attachments || replied.attachments.length === 0) {
        return message.reply("❌ Please reply to a View Once image, video, or audio message.");
      }

      const attachment = replied.attachments[0];
      const validTypes = ["image", "video", "audio", "ptt"];
      if (!validTypes.includes(attachment.type)) {
        return message.reply(`❌ Unsupported media type: ${attachment.type}`);
      }

      await message.react("⏳");

      let buffer;
      try {
        const msgObj = {
          key: {
            id: replied.messageID,
            remoteJid: event.threadID,
            participant: replied.senderID
          },
          message: replied.raw
        };
        buffer = await downloadMediaMessage(msgObj, "buffer", {}, { reuploadRequest: api.updateMediaMessage });
      } catch (err) {
        await message.react("❌");
        return message.reply("❌ Failed to decrypt/download media: " + err.message);
      }

      if (!buffer) {
        await message.react("❌");
        return message.reply("❌ Downloaded buffer is empty.");
      }

      // Preserve the original caption if there was one
      const caption = attachment.caption ? `*Caption:* ${attachment.caption}` : "";

      await message.react("✅");

      // Resend based on type
      if (attachment.type === "image") {
        await api.sendImage(buffer, event.threadID, caption, { mimetype: attachment.mimetype || "image/jpeg" });
      } else if (attachment.type === "video") {
        await api.sendVideo(buffer, event.threadID, caption, { mimetype: attachment.mimetype || "video/mp4" });
      } else if (attachment.type === "audio" || attachment.type === "ptt") {
        await api.sendAudio(buffer, event.threadID, { mimetype: attachment.mimetype || "audio/mpeg", ptt: attachment.type === "ptt" });
      }

    } catch (e) {
      await message.react("❌");
      return message.reply("❌ Error: " + e.message);
    }
  }
};
