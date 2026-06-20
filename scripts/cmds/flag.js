"use strict";

const axios = require("axios");

// Fetches all country codes + names from Flagpedia, then returns a random one
// Source: https://flagpedia.net/download/api
const getRandomFlag = async () => {
  const { data: codes } = await axios.get("https://flagcdn.com/en/codes.json");
  const entries = Object.entries(codes);
  const [code, country] = entries[Math.floor(Math.random() * entries.length)];

  return {
    country,
    names: [country.toLowerCase()],
    link: `https://flagcdn.com/w320/${code}.png`,
    code,
  };
};

module.exports = {
  config: {
    name: "flag",
    aliases: ["flaggame", "guessflag"],
    version: "4.6",
    author: "Rômeo",
    countDown: 10,
    role: 0,
    shortDescription: "Guess the country by its flag",
    longDescription: "A mini-game where the bot sends a flag and you have to guess the country to win Money.",
    category: "game",
    guide: {
      en: "{pn} | {pn} list | {pn} reset",
    },
  },

  onReply: async function ({ api, message, event, Reply, userData, threadsData }) {
    const { names, country, attempts, messageID: botMsgID } = Reply;
    const maxAttempts = 3;
    const senderID = event.senderID;
    const input = event.body ? event.body.trim().toLowerCase() : "";

    const isCorrect = names.includes(input);

    if (isCorrect) {
      try {
        const rewardCoin = 1000;

        const u = await userData(senderID);
        if (global.ST && global.ST.DB && global.ST.DB.users) {
          await global.ST.DB.users.set(senderID, {
            money: (u.money || 0) + rewardCoin
          });
        }

        const t = await threadsData(event.threadID);
        if (!t.data) t.data = {};
        if (!t.data.flagWins) t.data.flagWins = {};
        t.data.flagWins[senderID] = (t.data.flagWins[senderID] || 0) + 1;

        if (global.ST && global.ST.DB && global.ST.DB.threads) {
          await global.ST.DB.threads.set(event.threadID, { data: t.data });
        }

        global.ST.onReply.delete(botMsgID);

        try {
          if (botMsgID) {
            await api.deleteMessage(event.threadID, {
              remoteJid: event.threadID,
              id: botMsgID,
              fromMe: true,
            }, true);
          }
        } catch (e) { }

        return message.reply(`✨ | Correct! It is *${country}*.\n💰 | Rewards: +${rewardCoin} coins.`);
      } catch (err) {
        console.error(err);
      }
    } else {
      const newAttempts = attempts + 1;
      if (newAttempts >= maxAttempts) {
        global.ST.onReply.delete(botMsgID);
        return message.reply(`❌ | Out of tries! The answer was: *${country}*`);
      }

      Reply.attempts = newAttempts;
      global.ST.onReply.set(botMsgID, Reply);

      return message.reply(`❌ | Wrong Answer! (${newAttempts}/${maxAttempts})`);
    }
  },

  onStart: async function ({ api, args, event, message, userData, threadsData }) {
    try {
      if (!args[0]) {
        const { link, country, names } = await getRandomFlag();
        const hiddenName = country.replace(/[a-zA-Z]/g, "_ ");

        let buffer;
        try {
          const res = await axios.get(link, { responseType: 'arraybuffer' });
          buffer = Buffer.from(res.data);
        } catch (e) {
          return message.reply("❌ Error downloading flag image.");
        }

        const msgInfo = await api.sendImage(
          buffer,
          event.threadID,
          `🌍 | Guess the Country!\n📝 | Name: ${hiddenName}\n\n💡 | Reply to this message with your guess!`
        );

        const sentID = msgInfo?.key?.id;

        if (sentID) {
          global.ST.onReply.set(sentID, {
            commandName: module.exports.config.name,
            messageID: sentID,
            country,
            names,
            attempts: 0
          });
        }
        return;
      }

      if (args[0] === "list") {
        const t = await threadsData(event.threadID);
        const wins = (t.data && t.data.flagWins) ? t.data.flagWins : {};
        const sorted = Object.entries(wins).sort((a, b) => b[1] - a[1]).slice(0, 10);

        if (sorted.length === 0) return message.reply("🏆 | No wins recorded yet.");

        let msg = "🏆 *Leaderboard (Top 10):*\n\n";
        for (let i = 0; i < sorted.length; i++) {
          const uid = sorted[i][0];
          let dName = uid;
          const u = await userData(uid);
          if (u && u.name && u.name !== "Unknown") dName = u.name;
          else {
            try {
              const sock = api.ctx ? api.ctx.sock : null;
              if (sock && sock.contacts && sock.contacts[uid]) {
                dName = sock.contacts[uid].notify || sock.contacts[uid].name || uid;
              }
            } catch (e) { }
          }

          if (dName === uid) dName = "+" + uid.split('@')[0].split(':')[0];

          msg += `${i + 1}. ${dName} - ${sorted[i][1]} wins\n`;
        }
        return message.reply(msg);
      }

      if (args[0] === "reset") {
        const isBotAdmin = global.ST.config.adminIDs && global.ST.config.adminIDs.includes(event.senderID);

        let isAdmin = false;
        try {
          const tInfo = await threadsData(event.threadID);
          isAdmin = tInfo.adminIDs && tInfo.adminIDs.includes(event.senderID);
        } catch (e) { }

        if (!isBotAdmin && !isAdmin) return message.reply("⚠️ | Permission denied. Only Admins can reset.");

        const t = await threadsData(event.threadID);
        if (t.data) t.data.flagWins = {};
        if (global.ST && global.ST.DB && global.ST.DB.threads) {
          await global.ST.DB.threads.set(event.threadID, { data: t.data });
        }
        return message.reply("✅ | Leaderboard cleared.");
      }
    } catch (error) {
      return message.reply(`❌ | Error: ${error.message}`);
    }
  }
};
