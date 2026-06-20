"use strict";

const DIG = require("@zorner/discord-image-generation");
const axios = require('axios');

module.exports = {
  config: {
    name: "gay",
    aliases: ["rainbow"],
    version: "1.0",
    author: "Taseen / Romeo",
    countDown: 5,
    role: 0,
    shortDescription: "rainbowify someone's avatar",
    longDescription: "Overlays a rainbow flag on a user's profile picture.",
    category: "fun",
    guide: { en: "{pn} [@mention]" }
  },

  onStart: async function ({ api, event, args, message }) {
    await message.react("⏳");

    let targetUID = event.senderID;
    if (global.getTargetUser) {
      targetUID = global.getTargetUser(event, args) || event.senderID;
    } else if (event.mentions && event.mentions.length > 0) {
      targetUID = event.mentions[0];
    } else if (event.mentions && Object.keys(event.mentions).length > 0) {
      targetUID = Object.keys(event.mentions)[0];
    }

    try {
      const targetUrl = await global.ST.DB.userData.getAvatarUrl(api, targetUID);
      const res = await axios.get(targetUrl, { responseType: 'arraybuffer', timeout: 5000 });
      const avatarBuffer = Buffer.from(res.data);

      const imgBuffer = await new DIG.Gay().getImage(avatarBuffer);

      await message.react("✅");
      await api.sendImage(imgBuffer, event.threadID, "🏳️‍🌈");
    } catch (e) {
      console.error(e);
      await message.react("❌");
      await message.reply("❌ Error generating image: " + e.message);
    }
  }
};
