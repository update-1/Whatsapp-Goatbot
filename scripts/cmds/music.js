"use strict";

const axios = require("axios");
const yts = require("yt-search");

const API_URL = "https://ytb-downloader-api.vercel.app/sing";

function isUrl(text) {
  return /^https?:\/\//i.test(String(text || ""));
}

async function getDownloadData(url) {
  const res = await axios.get(API_URL, {
    params: { url },
    timeout: 60000,
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  if (!res.data || res.data.success !== true) {
    throw new Error(res.data?.error || res.data?.message || "Download API failed");
  }
  return res.data;
}

async function downloadAudioBuffer(data) {
  const audioUrl = data?.download_url;
  if (!audioUrl) throw new Error("No audio URL returned by API");

  const res = await axios.get(audioUrl, {
    responseType: "arraybuffer",
    timeout: 120000,
    maxRedirects: 5,
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  const contentType = String(res.headers["content-type"] || "");
  if (/json|html/i.test(contentType)) {
    throw new Error("Audio URL returned " + contentType + " instead of audio");
  }

  return Buffer.from(res.data);
}

function formatInfo(data) {
  return (
    `🎧 Music: ${data.title || "Unknown"}\n` +
    `👤 Artist: ${data.channelName || "Unknown"}\n` +
    `⏱️ Duration: ${data.duration || "Unknown"}`
  );
}

async function sendMusic({ api, message, event, videoUrl }) {
  try {
    const data = await getDownloadData(videoUrl);

    // Send thumbnail with info
    const audioBuffer = await downloadAudioBuffer(data);

    const promises = [];
    if (data.thumbnail) {
      promises.push(message.reply({
        body: formatInfo(data),
        attachment: { type: "image", url: data.thumbnail, mimetype: "image/jpeg" }
      }));
    } else {
      promises.push(message.reply(formatInfo(data)));
    }

    promises.push(api.sendAudio(audioBuffer, event.threadID, {
      mimetype: "audio/mpeg",
      ptt: false
    }));

    await Promise.all(promises);
    await message.react("✅");
  } catch (e) {
    await message.react("❌");
    await message.reply("Download failed: " + e.message).catch(() => { });
  }
}

module.exports = {
  config: {
    name: "music",
    aliases: ["sing", "play"],
    version: "2.5.0",
    author: "Rômeo",
    role: 0,
    category: "music",
    guide: { en: "{pn} [-s] <song name | youtube url>" },
  },

  onStart: async function ({ api, message, args, event }) {
    if (!args[0]) return message.reply("Enter song name or YouTube URL.");
    await message.react("⏳");

    let showList = false;
    if (args[0] === "-s") {
      showList = true;
      args.shift();
    }

    const query = args.join(" ").trim();
    if (!query) return message.reply("Enter song name or YouTube URL.");


    if (!showList) {
      if (isUrl(query)) {
        return sendMusic({ api, message, event, videoUrl: query });
      }

      try {
        const search = await yts(query);
        if (!search.videos.length) {
          return message.reply("No results found.");
        }
        return sendMusic({ api, message, event, videoUrl: search.videos[0].url });
      } catch (e) {
        return message.reply("Error: " + e.message);
      }
    }

    try {
      const search = await yts(query);
      if (!search.videos.length) {
        return message.reply("No results found.");
      }

      const top = search.videos.slice(0, 6);
      let msg = `Results for "${query}"\n\n`;
      top.forEach((v, i) => {
        msg += `${i + 1}. ${v.title}\nDuration: ${v.timestamp}\n\n`;
      });
      msg += "Reply with a number.";

      const info = await message.reply(msg);
      if (info?.messageID) {
        global.GoatBot.onReply.set(info.messageID, {
          commandName: module.exports.config.name,
          author: event.senderID,
          videos: top,
        });
      }
      return;
    } catch (e) {
      return message.reply("Error: " + e.message);
    }
  },

  onReply: async function ({ api, message, event, Reply, userData }) {
    if (event.senderID !== Reply.author) return message.reply("Not your request.");
    await message.react("⏳");

    const choice = parseInt(event.body, 10);
    if (Number.isNaN(choice) || choice < 1 || choice > Reply.videos.length) {
      return message.reply("Invalid choice.");
    }

    const replyID = event.messageReply?.messageID || event.replyToMessage?.messageID;
    if (replyID) {
      global.GoatBot.onReply.delete(replyID);
      await message.unsend(replyID).catch(() => { });
    }

    return sendMusic({
      api,
      message,
      event,
      videoUrl: Reply.videos[choice - 1].url
    });
  }
};
