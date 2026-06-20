"use strict";

const axios = require("axios");

const API_URL = "https://all-downloader-web.vercel.app/allLink";

async function getDownloadData(url) {
  const res = await axios.get(API_URL, {
    params: { link: url },
    headers: { "User-Agent": "Mozilla/5.0" },
    timeout: 20000,
  });

  if (!res.data?.success) {
    throw new Error(res.data?.message || res.data?.error || "Download API failed");
  }
  return res.data;
}

function formatDuration(secs) {
  if (!secs) return "Unknown";
  const s = Math.floor(secs);      // drop any decimal / ms
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  if (m > 0) return `${m}:${String(s % 60).padStart(2, "0")}`;
  return `${s}s`;
}

function formatCaption(data) {
  const title = (data.video_title || "").trim().slice(0, 120);
  const author = data.author || "Unknown";
  const platform = (data.platform || "unknown").toUpperCase();
  const duration = formatDuration(data.duration);

  let cap = `📥 *${platform}* Video\n`;
  cap += `👤 ${author}\n`;
  cap += `⏱️ ${duration}\n`;
  if (title) cap += `\n📝 ${title}`;
  return cap;
}

module.exports = {
  config: {
    name: "autodl",
    aliases: ["dl"],
    version: "3.0.0",
    author: "Rômeo",
    role: 0,
    category: "media",
    shortDescription: "Auto download video from URL",
    longDescription: "Downloads videos from Instagram, TikTok, YouTube Shorts, Facebook, and more.",
    guide: { en: "{pn} <url>  —or—  reply to a message containing a URL" },
  },

  onStart: async ({ api, message, event, args }) => {
    let status = null;

    try {
      // 1. URL from args
      let url = args[0];

      // 2. No URL in args — check the replied-to message body
      if (!url) {
        const replied = event.messageReply || event.replyToMessage;
        const repliedBody = replied?.body || replied?.conversation ||
          replied?.extendedTextMessage?.text || "";
        // extract first http(s) URL from replied body
        const match = repliedBody.match(/https?:\/\/[^\s]+/);
        if (match) url = match[0];
      }

      if (!url) {
        return message.reply(
          "❌ Please provide a URL or reply to a message that contains one.\n" +
          "Usage: !autodl <url>  |  !dl <url>"
        );
      }
      if (!/^https?:\/\//i.test(url)) return message.reply("❌ Please provide a valid URL starting with http/https.");

      status = await message.reply("⏳ Downloading...");

      const data = await getDownloadData(url);
      const videoUrl = data.download_url;
      if (!videoUrl) throw new Error("No download URL returned by API.");

      if (status?.messageID) await message.unsend(status.messageID).catch(() => { });

      await api.sendVideo(videoUrl, event.threadID, formatCaption(data), {
        mimetype: "video/mp4",
      });

    } catch (err) {
      if (status?.messageID) await message.unsend(status.messageID).catch(() => { });
      await message.reply("❌ Download failed: " + err.message).catch(() => { });
    }
  }
};
