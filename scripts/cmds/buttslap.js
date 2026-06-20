"use strict";

const DIG = require("@zorner/discord-image-generation");
const axios = require('axios');

module.exports = {
  config: {
    name: "buttslap",
    aliases: ["buttslap"],
    version: "1.0",
    author: "Rômeo",
    countDown: 5,
    role: 0,
    shortDescription: "buttslap someone",
    longDescription: "Slaps someone on their butt using their avatar.",
    category: "fun",
    guide: { en: "{pn} [@mention]" }
  },

  onStart: async function ({ api, event, args, message }) {
   let mentionJid = null;
    if (event.mentions && event.mentions.length > 0) {
      mentionJid = event.mentions[0];
    } else if (event.mentions && Object.keys(event.mentions).length > 0) {
      mentionJid = Object.keys(event.mentions)[0];
    }

    if (!mentionJid) {
      return message.reply("Please mention someone.");
    }


    try {
      const one = event.senderID;
      const two = mentionJid;

      const oneUrl = await global.ST.DB.userData.getAvatarUrl(api, one);
      const twoUrl = await global.ST.DB.userData.getAvatarUrl(api, two);

      const [resOne, resTwo] = await Promise.all([
        axios.get(oneUrl, { responseType: 'arraybuffer', timeout: 8000 }),
        axios.get(twoUrl, { responseType: 'arraybuffer', timeout: 8000 })
      ]);

      const avatarOne = Buffer.from(resOne.data);
      const avatarTwo = Buffer.from(resTwo.data);

      const imgBuffer = await new DIG.Batslap().getImage(avatarOne, avatarTwo);

      await api.sendImage(imgBuffer, event.threadID, "👋😹 move your butt");
    } catch (e) {
      console.error(e);
      await message.reply("❌ Error generating image: " + e.message);
    }
  }
};