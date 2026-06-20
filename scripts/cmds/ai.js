const axios = require('axios');
const validUrl = require('valid-url');

const API_ENDPOINT = "https://shizuai.vercel.app/chat";
const CLEAR_ENDPOINT = "https://shizuai.vercel.app/chat/clear";

const getBuffer = async (url) => {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
};

const resetConversation = async (api, event, message) => {
    await message.react("♻️");
    try {
        await axios.delete(`${CLEAR_ENDPOINT}/${event.senderID}`);
        return message.reply(`✅ Conversation reset for UID: ${event.senderID}`);
    } catch (error) {
        console.error('❌ Reset Error:', error.message);
        return message.reply("❌ Reset failed. Try again.");
    }
};

const handleAIRequest = async (api, event, userInput, message, isReply = false) => {
    const userId = event.senderID;
    let messageContent = userInput;
    let imageUrl = null;

    await message.react("⏳");

    if (event.messageReply) {
        const replyData = event.messageReply;
        if (replyData.senderID !== global.GoatBot?.botID && replyData.body) {
            const trimmedReply = replyData.body.length > 300
                ? replyData.body.slice(0, 300) + "..."
                : replyData.body;
            messageContent += `\n\n📌 Reply:\n"${trimmedReply}"`;
        }
        const attachment = replyData.attachments?.[0];
        if (attachment?.type === 'photo') imageUrl = attachment.url;
    }

    const urlMatch = messageContent.match(/(https?:\/\/[^\s]+)/)?.[0];
    if (urlMatch && validUrl.isWebUri(urlMatch)) {
        imageUrl = urlMatch;
        messageContent = messageContent.replace(urlMatch, '').trim();
    }

    if (!messageContent && !imageUrl) {
        await message.react("❌");
        return message.reply("💬 Provide a message or image.");
    }

    try {
        const response = await axios.post(
            API_ENDPOINT,
            { uid: userId, message: messageContent, image_url: imageUrl },
            { timeout: 60000 }
        );

        const {
            reply: textReply,
            image_url: genImageUrl,
            music_data: musicData,
            video_data: videoData,
            shotti_data: shotiData,
            lyrics_data: lyricsData
        } = response.data;

        let finalReply = textReply || '✅ AI Response:';

        if (lyricsData) {
            try {
                const maxLength = 1500;
                let lyricsText = lyricsData.lyrics;
                if (lyricsText.length > maxLength) {
                    lyricsText = lyricsText.substring(0, maxLength) + '... [truncated]';
                }
                finalReply += `\n\n🎵 Lyrics for "${lyricsData.track_name}":\n${lyricsText}`;
            } catch {
                finalReply += '\n📝 Lyrics processing failed.';
            }
        }

        const sentMessage = await message.reply(finalReply);

        if (genImageUrl) {
            try { await api.sendImage(await getBuffer(genImageUrl), event.threadID); } catch {}
        }
        if (musicData?.downloadUrl) {
            try { await api.sendAudio(await getBuffer(musicData.downloadUrl), event.threadID); } catch {}
        }
        if (videoData?.downloadUrl) {
            try { await api.sendVideo(await getBuffer(videoData.downloadUrl), event.threadID); } catch {}
        }
        if (shotiData?.videoUrl) {
            try { await api.sendVideo(await getBuffer(shotiData.videoUrl), event.threadID); } catch {}
        }

        if (sentMessage && sentMessage.messageID) {
            global.GoatBot.onReply.set(sentMessage.messageID, {
                commandName: 'ai',
                messageID: sentMessage.messageID,
                author: userId
            });
        }

        await message.react("✅");

    } catch (error) {
        console.error("❌ API Error:", error.response?.data || error.message);
        await message.react("❌");

        let errorMessage = "⚠️ AI Error:\n\n";
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
            errorMessage += "⏱️ Timeout. Try again.";
        } else if (error.response?.status === 429) {
            errorMessage += "🚦 Too many requests. Slow down.";
        } else {
            errorMessage += "❌ Unexpected error: " + (error.message || 'No details');
        }

        return message.reply(errorMessage);
    }
};

module.exports = {
    config: {
        name: 'ai',
        aliases: [],
        version: '2.0.0',
        author: 'Aryan Chauhan',
        role: 0,
        category: 'ai',
        shortDescription: "Advanced AI chatbot",
        longDescription: {
            en: 'Advanced AI with image gen, music/video, lyrics, and Shoti'
        },
        guide: {
            en: `.ai [your message]  
• 🤖 Chat, 🎨 Image, 🎵 Music, 🎬 Video  
• 🎵 Lyrics: "lyrics [song name]"  
• 🎬 Shoti: "shoti" for random TikTok  
• 🔄 Reply "clear" to reset conversation  
• 💬 Works in chat: "ai [message]"`
        }
    },

    onStart: async function ({ api, event, args, message }) {
        const userInput = args.join(' ').trim();
        if (!userInput) return message.reply("❗ Please enter a message.");

        if (['clear', 'reset'].includes(userInput.toLowerCase())) {
            return await resetConversation(api, event, message);
        }

        return await handleAIRequest(api, event, userInput, message);
    },

    onReply: async function ({ api, event, Reply, message }) {
        if (event.senderID !== Reply.author) return;

        const userInput = event.body?.trim();
        if (!userInput) return;

        if (['clear', 'reset'].includes(userInput.toLowerCase())) {
            return await resetConversation(api, event, message);
        }

        return await handleAIRequest(api, event, userInput, message, true);
    },

    onChat: async function ({ api, event, message }) {
        const body = event.body?.trim();
        if (!body?.toLowerCase().startsWith('ai ')) return;

        const userInput = body.slice(3).trim();
        if (!userInput) return;

        return await handleAIRequest(api, event, userInput, message);
    }
};