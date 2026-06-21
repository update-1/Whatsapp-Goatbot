"use strict";

module.exports = {
  config: {
    name: "pp",
    version: "1.1.0",
    author: "Rômeo",
    countDown: 10,
    role: 0,
    shortDescription: "Get profile picture of a user or group",
    longDescription: "Sends the profile picture of a mentioned user, replied user, or yourself.",
    category: "info",
    guide: { en: "{pn} [@mention | reply | uid]" }
  },

  onStart: async ({ api, event, args, message }) => {
    const targetUID = global.getTargetUser
      ? global.getTargetUser(event, args)
      : (event.mentions && event.mentions[0]) || event.senderID;

    await message.react("⏳");

    let ppUrl = null;
    try {
      ppUrl = await global.GoatBot.DB.userData.getAvatarUrl(api, targetUID);
    } catch (_) { }

    const { jidToPhone } = require("../../utils.js");
    const phone = jidToPhone(targetUID);

    try {
      const axios = require("axios");
      const res = await axios.get(ppUrl, { responseType: "arraybuffer", timeout: 5000 });
      const buffer = Buffer.from(res.data);

      await api.sendImage(buffer, event.threadID, `📸 Profile picture of ${phone}`);
      await message.react("✅");
    } catch (e) {
      await message.react("❌");
      return message.reply("❌ Failed to send profile picture: " + e.message);
    }
  }
};