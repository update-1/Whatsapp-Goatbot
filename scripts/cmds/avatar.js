"use strict";

const axios = require("axios");

module.exports = {
  config: {
    name: "avatar",
    version: "1.0.0",
    author: "Rômeo",
    role: 1, // Admin only command
    shortDescription: "Change bot avatar",
    longDescription: "Set the bot's profile picture by replying to an image or providing an image URL.",
    category: "admin",
    guide: { en: "{pn} [reply to image | image url]" }
  },

  onStart: async ({ api, event, args, message }) => {
    let buffer = null;

    try {
      // 1. Try to get image from a replied message using native Baileys downloader
      const replied = event.messageReply || event.replyToMessage;
      let dlError = null;
      if (replied && replied.raw) {
        try {
          const { downloadMediaMessage } = require("@whiskeysockets/baileys");
          // Format message correctly for Baileys
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
          dlError = err.message;
        }
      }

      // 2. Try to get image from a direct URL
      if (!buffer && args[0] && /^https?:\/\//i.test(args[0])) {
        const res = await axios.get(args[0], { responseType: "arraybuffer", timeout: 10000 });
        buffer = Buffer.from(res.data);
      }

      if (!buffer) {
        if (dlError) return message.reply("❌ Failed to download replied image: " + dlError);
        return message.reply("❌ Please reply to an image or provide a valid image URL to set the avatar.");
      }

      await message.react("⏳");
      
      // Update the bot's profile picture
      await api.updateProfilePicture(buffer);
      
      await message.react("✅");
      await message.reply("✅ Bot avatar updated successfully.");

    } catch (e) {
      await message.react("❌");
      return message.reply("❌ Failed to update avatar: " + e.message);
    }
  }
};
