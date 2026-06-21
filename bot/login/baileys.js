"use strict";

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers,
    downloadMediaMessage,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");


// ─── ANSI colours ────────────────────────────────────────────────────────────
const C = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    green: "\x1b[32m",
    cyan: "\x1b[36m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    magenta: "\x1b[35m",
    bGreen: "\x1b[92m",
    bCyan: "\x1b[96m",
    bYellow: "\x1b[93m",
    bWhite: "\x1b[97m",
    dim: "\x1b[2m",
};

const normUID = (jid) => {
    if (!jid) return "";
    if (Array.isArray(jid)) jid = jid[0];
    if (typeof jid !== "string") return "";
    return jid.split(":")[0].split("@")[0];
};

const normalizeJID = (jid) => {
    if (!jid) return "";
    if (Array.isArray(jid)) jid = jid[0];
    if (typeof jid !== "string") return "";
    if (jid.includes("@g.us")) return jid;
    if (jid.includes("@lid")) return jid;
    if (jid.includes("@s.whatsapp.net")) return jid;
    return normUID(jid) + "@s.whatsapp.net";
};

const isGroupJID = (jid) => {
    return !!(jid && jid.endsWith("@g.us"));
};

function guessMediaType(media) {
    if (typeof media !== "string") return "document";
    const clean = media.split("?")[0].toLowerCase();
    if (/\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(clean)) return "image";
    if (/\.(mp4|mkv|3gp|avi|mov|webm)$/i.test(clean)) return "video";
    if (/\.(mp3|m4a|ogg|wav|opus|aac)$/i.test(clean)) return "audio";
    return "document";
}

const resolveMedia = (media) => {
    if (!media) return media;
    if (typeof media === "string") {
        return { url: media.trim() };
    }
    if (media instanceof Readable) {
        return { stream: media };
    }
    return media;
};


function extractAttachments(msgContent) {
    const attachments = [];
    if (!msgContent) return attachments;

    // Normalize if it's viewOnce or ephemeral or documentWithCaption
    const normalized = msgContent.viewOnceMessage?.message ||
                       msgContent.viewOnceMessageV2?.message ||
                       msgContent.viewOnceMessageV2Extension?.message ||
                       msgContent.ephemeralMessage?.message ||
                       msgContent.documentWithCaptionMessage?.message ||
                       msgContent;

    if (normalized.imageMessage) {
        attachments.push({
            type: "image",
            mimetype: normalized.imageMessage.mimetype || "image/jpeg",
            caption: normalized.imageMessage.caption || "",
            url: normalized.imageMessage.url,
            raw: normalized.imageMessage,
        });
    }
    if (normalized.videoMessage) {
        attachments.push({
            type: "video",
            mimetype: normalized.videoMessage.mimetype || "video/mp4",
            caption: normalized.videoMessage.caption || "",
            url: normalized.videoMessage.url,
            raw: normalized.videoMessage,
        });
    }
    if (normalized.audioMessage) {
        attachments.push({
            type: "audio",
            mimetype: normalized.audioMessage.mimetype || "audio/ogg",
            ptt: !!normalized.audioMessage.ptt,
            url: normalized.audioMessage.url,
            raw: normalized.audioMessage,
        });
    }
    return attachments;
}

// Formats message events to match FCA structure
function formatMessageEvent(msg, selfID, sock) {
    const key = msg.key;
    if (!key) return null;

    const threadID = normalizeJID(key.remoteJid);
    const isGroup = isGroupJID(key.remoteJid);
    const senderRaw = key.fromMe ? selfID : (isGroup ? key.participant : key.remoteJid);
    const senderID = normalizeJID(senderRaw);

    if (!msg.message) return null;

    // Extract body text
    const msgContent = msg.message;
    const innerQuoted = msgContent.viewOnceMessage?.message ||
                        msgContent.viewOnceMessageV2?.message ||
                        msgContent.viewOnceMessageV2Extension?.message ||
                        msgContent.ephemeralMessage?.message ||
                        msgContent.documentWithCaptionMessage?.message ||
                        msgContent;

    const inner =
        innerQuoted.conversation ||
        innerQuoted.extendedTextMessage?.text ||
        innerQuoted.imageMessage?.caption ||
        innerQuoted.videoMessage?.caption ||
        "";

    const attachments = extractAttachments(msgContent);

    const mentions = [];
    if (msgContent.extendedTextMessage?.contextInfo?.mentionedJid) {
        mentions.push(...msgContent.extendedTextMessage.contextInfo.mentionedJid);
    }

    let messageReply = null;
    const quoted = msgContent.extendedTextMessage?.contextInfo?.quotedMessage;
    if (quoted) {
        const quotedKey = msgContent.extendedTextMessage.contextInfo.stanzaId;
        const quotedParticipant = msgContent.extendedTextMessage.contextInfo.participant;
        
        const innerQuotedMsg = quoted.viewOnceMessage?.message ||
                               quoted.viewOnceMessageV2?.message ||
                               quoted.viewOnceMessageV2Extension?.message ||
                               quoted.ephemeralMessage?.message ||
                               quoted.documentWithCaptionMessage?.message ||
                               quoted;

        const body = innerQuotedMsg.conversation || 
                     innerQuotedMsg.extendedTextMessage?.text || 
                     innerQuotedMsg.imageMessage?.caption || 
                     innerQuotedMsg.videoMessage?.caption || 
                     "";

        messageReply = {
            messageID: quotedKey,
            senderID: normalizeJID(quotedParticipant),
            body: body,
            attachments: extractAttachments(quoted),
            raw: quoted,
        };
    }

    return {
        type: "message",
        messageID: key.id,
        threadID,
        senderID,
        body: inner,
        isGroup,
        fromMe: !!key.fromMe,
        attachments,
        mentions,
        messageReply,
        replyToMessage: messageReply,
        raw: msg,
    };
}


function baileysConnect(options, callback) {
    options = options || {};
    const authFolder = options.authFolder || "./auth";
    const globalOptions = Object.assign(
        {
            selfListen: false,
            listenEvents: true,
            autoReconnect: true,
            autoMarkDelivery: false,
            online: true,
        },
        options.globalOptions || {}
    );

    let ctx = {
        selfID: null,
        sock: null,
        globalOptions,
    };

    async function startConnection() {
        let qrCodeTerminal;
        try { qrCodeTerminal = require("qrcode-terminal"); } catch (_) {}

        const { state, saveCreds } = await useMultiFileAuthState(authFolder);
        const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1023451250] }));

        const phoneNumber = options.phoneNumber ? normUID(String(options.phoneNumber)) : null;
        const usePairingCode = options.usePairingCode || !!phoneNumber;
        const printQR = options.printQR !== false && !usePairingCode;

        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: printQR,
            browser: Browsers ? Browsers.ubuntu("Chrome") : ["Ubuntu", "Chrome", "20.0.04"],
            syncFullHistory: false,
            markOnlineOnConnect: globalOptions.online !== false,
            logger: pino({ level: "silent" }),
            generateHighQualityLinkPreview: true,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
        });

        ctx.sock = sock;
        sock.ev.on("creds.update", saveCreds);

        let pairCodeRequested = false;
        let builtAPI = null;
        let _listenCb = null;

        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr && printQR) {
                if (qrCodeTerminal) {
                    console.log(C.cyan + "Scan QR Code:\n" + C.reset);
                    qrCodeTerminal.generate(qr, { small: true });
                } else {
                    console.log(C.yellow + "QR: " + qr + C.reset);
                }
            }

            if (qr && usePairingCode && phoneNumber && !pairCodeRequested) {
                pairCodeRequested = true;
                try {
                    await new Promise(r => setTimeout(r, 2000));
                    const code = await sock.requestPairingCode(phoneNumber);
                    console.log(C.bGreen + "Pairing Code: " + C.bYellow + code + C.reset);
                } catch (e) {
                    console.log(C.red + "Failed to get pairing code: " + e.message + C.reset);
                }
            }

            if (connection === "open") {
                ctx.selfID = sock.user?.id || "";
                if (!builtAPI) {
                    builtAPI = buildAPI(sock, ctx);
                    callback(null, builtAPI);
                } else {
                    if (_listenCb) {
                        bindListener(sock, ctx, _listenCb);
                    }
                }
            }

            if (connection === "close") {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const loggedOut = statusCode === DisconnectReason.loggedOut;

                if (loggedOut) {
                    try { fs.rmSync(authFolder, { recursive: true, force: true }); } catch (_) {}
                    callback(new Error("logged_out"), null);
                    return;
                }

                console.log(C.yellow + "Connection closed. Reason: " + (lastDisconnect?.error?.message || lastDisconnect?.error || "Unknown") + C.reset);
                console.log(C.cyan + "Restarting process for a clean reconnection..." + C.reset);
                process.exit(2);
            }
        });
    }

    function bindListener(sock, ctx, listenCallback) {
        sock.ev.on("messages.upsert", async ({ messages, type }) => {
            if (type !== "notify" && type !== "append") return;

            for (const msg of messages) {
                if (!msg.message) continue;
                if (msg.key?.remoteJid === "status@broadcast") continue;

                const event = formatMessageEvent(msg, ctx.selfID, sock);
                if (!event) continue;

                if (event.fromMe && !globalOptions.selfListen) continue;

                if (globalOptions.autoMarkDelivery && msg.key) {
                    try { await sock.readMessages([msg.key]); } catch (_) {}
                }

                listenCallback(null, event);
            }
        });

        sock.ev.on("messages.reaction", (reactions) => {
            if (!globalOptions.listenEvents) return;
            for (const { key, reaction } of reactions) {
                const threadID = normalizeJID(key.remoteJid);
                const sender = normalizeJID(reaction.key?.fromMe ? ctx.selfID : reaction.key?.participant);
                listenCallback(null, {
                    type: "message_reaction",
                    threadID,
                    senderID: sender,
                    author: sender,
                    messageID: reaction.key?.id || key.id,
                    isGroup: isGroupJID(key.remoteJid),
                    fromMe: !!reaction.key?.fromMe,
                    emoji: reaction.text || "",
                    removed: !reaction.text,
                    reactionKey: key,
                });
            }
        });

        sock.ev.on("group-participants.update", async (update) => {
            if (!globalOptions.listenEvents) return;
            const { id, participants, action, author } = update;
            const selfID = ctx.selfID;

            const normalizedThreadID = normalizeJID(id);
            const normalizedParticipants = participants.map(p => normalizeJID(p));
            const normalizedAuthor = author ? normalizeJID(author) : normalizedThreadID;

            if (action === "add") {
                listenCallback(null, {
                    type: "event",
                    logMessageType: "log:subscribe",
                    threadID: normalizedThreadID,
                    senderID: normalizedAuthor,
                    isGroup: true,
                    participants: normalizedParticipants,
                    isBotAdded: participants.some(p => normUID(p) === normUID(selfID)),
                });
            } else if (action === "remove") {
                listenCallback(null, {
                    type: "event",
                    logMessageType: "log:unsubscribe",
                    threadID: normalizedThreadID,
                    senderID: normalizedAuthor,
                    isGroup: true,
                    participants: normalizedParticipants,
                    isBotRemoved: participants.some(p => normUID(p) === normUID(selfID)),
                });
            } else if (action === "promote" || action === "demote") {
                const isBot = participants.some(p => normUID(p) === normUID(selfID));
                listenCallback(null, {
                    type: "event",
                    logMessageType: "log:thread-admins",
                    threadID: normalizedThreadID,
                    senderID: normalizedAuthor,
                    isGroup: true,
                    action: action,
                    participants: normalizedParticipants,
                    isBotPromoted: action === "promote" && isBot,
                    isBotDemoted: action === "demote" && isBot,
                });
            }
        });

        sock.ev.on("groups.update", async (updates) => {
            if (!globalOptions.listenEvents) return;
            for (const update of updates) {
                const { id, subject, author } = update;
                if (subject) {
                    const normalizedThreadID = normalizeJID(id);
                    const normalizedAuthor = author ? normalizeJID(author) : normalizedThreadID;
                    listenCallback(null, {
                        type: "group_update",
                        logMessageType: "log:thread-name",
                        threadID: normalizedThreadID,
                        senderID: normalizedAuthor,
                        isGroup: true,
                        logMessageData: { value: subject },
                        raw: update,
                    });
                }
            }
        });
    }

    function buildAPI(sock, ctx) {
        const api = {
            sock,
            ctx,
            getCurrentUserID: () => ctx.selfID,

            sendMessage: async (content, threadID, options = {}) => {
                const target = normalizeJID(threadID);
                const text = typeof content === "string" ? content : (content.body || "");
                const mentions = content && content.mentions ? content.mentions.map(m => normalizeJID(m)) : (options.mentions ? options.mentions.map(m => normalizeJID(m)) : []);
                
                let msgContent = { text };
                if (content && typeof content === "object" && content.attachment) {
                    const att = content.attachment;
                    let type = "document";
                    let mediaObj = resolveMedia(att);

                    if (typeof att === "string") {
                        type = guessMediaType(att);
                    } else if (att && typeof att === "object" && !(att instanceof Buffer) && !(att instanceof Readable)) {
                        if (att.type) {
                            type = att.type;
                        } else if (att.url) {
                            type = guessMediaType(att.url);
                        }
                        if (att.stream) {
                            mediaObj = resolveMedia(att.stream);
                        } else if (att.url) {
                            mediaObj = resolveMedia(att.url);
                        }
                    }

                    if (type === "ptt") {
                        msgContent = { audio: mediaObj, ptt: true, mimetype: att.mimetype || "audio/ogg" };
                    } else if (type === "audio") {
                        msgContent = { audio: mediaObj, ptt: false, mimetype: att.mimetype || "audio/mpeg" };
                    } else {
                        msgContent = { [type]: mediaObj, caption: text };
                        if (att && att.mimetype) {
                            msgContent.mimetype = att.mimetype;
                        }
                        if (att && att.fileName) {
                            msgContent.fileName = att.fileName;
                        }
                    }
                }

                if (mentions.length > 0) {
                    msgContent.mentions = mentions;
                }

                const sent = await sock.sendMessage(target, msgContent, {
                    quoted: options.replyToMessage,
                });
                return sent;
            },

            sendImage: async (buffer, threadID, caption, options = {}) => {
                const target = normalizeJID(threadID);
                const mentions = options.mentions ? options.mentions.map(m => normalizeJID(m)) : [];
                const msgContent = { image: resolveMedia(buffer), caption };
                if (mentions.length > 0) {
                    msgContent.mentions = mentions;
                }
                return await sock.sendMessage(target, msgContent, options);
            },

            sendVideo: async (buffer, threadID, caption, options = {}) => {
                const target = normalizeJID(threadID);
                const mentions = options.mentions ? options.mentions.map(m => normalizeJID(m)) : [];
                const msgContent = { video: resolveMedia(buffer), caption };
                if (mentions.length > 0) {
                    msgContent.mentions = mentions;
                }
                return await sock.sendMessage(target, msgContent, options);
            },

            sendAudio: async (buffer, threadID, options = {}) => {
                const target = normalizeJID(threadID);
                const mentions = options.mentions ? options.mentions.map(m => normalizeJID(m)) : [];
                const msgContent = { audio: resolveMedia(buffer), ptt: !!options.ptt, mimetype: options.mimetype || "audio/ogg" };
                if (mentions.length > 0) {
                    msgContent.mentions = mentions;
                }
                return await sock.sendMessage(target, msgContent, options);
            },


            reactToMessage: async (threadID, key, emoji) => {
                return await sock.sendMessage(normalizeJID(threadID), { react: { text: emoji, key } });
            },

            deleteMessage: async (threadID, key, forEveryone) => {
                const normalizedJid = normalizeJID(threadID);
                const messageKey = {
                    remoteJid: normalizeJID(key.remoteJid || threadID),
                    id: key.id || key,
                    fromMe: key.fromMe !== false,
                    participant: key.participant ? normalizeJID(key.participant) : undefined
                };
                return await sock.sendMessage(normalizedJid, { delete: messageKey });
            },

            getGroupInfo: async (threadID) => {
                return await sock.groupMetadata(normalizeJID(threadID));
            },

            getProfilePicture: async (jid) => {
                return await sock.profilePictureUrl(normalizeJID(jid), "image");
            },

            updateProfilePicture: async (buffer) => {
                return await sock.updateProfilePicture(normalizeJID(ctx.selfID), buffer);
            },

            kickUser: async (threadID, jids) => {
                const targets = Array.isArray(jids) ? jids.map(j => normalizeJID(j)) : [normalizeJID(jids)];
                return await sock.groupParticipantsUpdate(normalizeJID(threadID), targets, "remove");
            },

            promoteAdmin: async (threadID, jids) => {
                const targets = Array.isArray(jids) ? jids.map(j => normalizeJID(j)) : [normalizeJID(jids)];
                return await sock.groupParticipantsUpdate(normalizeJID(threadID), targets, "promote");
            },

            demoteAdmin: async (threadID, jids) => {
                const targets = Array.isArray(jids) ? jids.map(j => normalizeJID(j)) : [normalizeJID(jids)];
                return await sock.groupParticipantsUpdate(normalizeJID(threadID), targets, "demote");
            },

            updateMediaMessage: async (msgObj) => {
                if (typeof sock.updateMediaMessage === "function") {
                    return await sock.updateMediaMessage(msgObj);
                }
                return msgObj;
            },


            // ─── Profile & User ──────────────────────────────────────────────────
            updateProfileStatus: async (status) => {
                return await sock.updateProfileStatus(status);
            },

            updateProfileName: async (name) => {
                return await sock.updateProfileName(name);
            },

            fetchStatus: async (jid) => {
                return await sock.fetchStatus(normalizeJID(jid));
            },

            // ─── Presence Updates ───────────────────────────────────────────────
            sendPresenceUpdate: async (jid, presence) => {
                return await sock.sendPresenceUpdate(presence, normalizeJID(jid));
            },

            sendTypingIndicator: async (threadID, duration = 3000) => {
                const target = normalizeJID(threadID);
                await sock.sendPresenceUpdate("composing", target);
                await new Promise(r => setTimeout(r, duration));
                return await sock.sendPresenceUpdate("paused", target);
            },

            // ─── Receipts ────────────────────────────────────────────────────────
            sendReadReceipt: async (threadID, participant, messageIds) => {
                return await sock.readMessages([{ remoteJid: normalizeJID(threadID), id: messageIds[0], participant: normalizeJID(participant) }]);
            },

            // ─── Location ────────────────────────────────────────────────────────
            sendLocation: async (threadID, latitude, longitude, options = {}) => {
                return await sock.sendMessage(normalizeJID(threadID), { location: { degreesLatitude: latitude, degreesLongitude: longitude } }, options);
            },

            // ─── Muting, Archiving & Pinning ─────────────────────────────────────
            muteChat: async (threadID, duration = 8 * 60 * 60) => {
                return await sock.chatModify({ mute: duration }, normalizeJID(threadID));
            },

            unmuteChat: async (threadID) => {
                return await sock.chatModify({ mute: null }, normalizeJID(threadID));
            },

            archiveChat: async (threadID, archive = true) => {
                return await sock.chatModify({ archive: !!archive }, normalizeJID(threadID));
            },

            pinChat: async (threadID, pin = true) => {
                return await sock.chatModify({ pin: !!pin }, normalizeJID(threadID));
            },

            // ─── Blocking ────────────────────────────────────────────────────────
            blockContact: async (jid) => {
                return await sock.updateBlockStatus(normalizeJID(jid), "block");
            },

            unblockContact: async (jid) => {
                return await sock.updateBlockStatus(normalizeJID(jid), "unblock");
            },

            // ─── Group Invites & Settings ────────────────────────────────────────
            getGroupInviteLink: async (threadID) => {
                return await sock.groupInviteCode(normalizeJID(threadID));
            },

            groupRevokeInvite: async (threadID) => {
                return await sock.groupRevokeInvite(normalizeJID(threadID));
            },

            groupAcceptInvite: async (code) => {
                return await sock.groupAcceptInvite(code);
            },

            groupSettingUpdate: async (threadID, setting, value) => {
                return await sock.groupSettingUpdate(normalizeJID(threadID), setting);
            },

            // ─── Polls ───────────────────────────────────────────────────────────
            sendPoll: async (threadID, question, options = []) => {
                return await sock.sendMessage(normalizeJID(threadID), {
                    poll: {
                        name: question,
                        values: options,
                        selectableCount: 1
                    }
                });
            },

            // ─── Message Editing & Pinning ───────────────────────────────────────
            editMessage: async (threadID, messageID, newText) => {
                return await sock.sendMessage(normalizeJID(threadID), {
                    text: newText,
                    edit: {
                        remoteJid: normalizeJID(threadID),
                        id: messageID,
                        fromMe: true
                    }
                });
            },

            pinMessage: async (threadID, messageID, duration = 24 * 60 * 60) => {
                return await sock.sendMessage(normalizeJID(threadID), {
                    pin: {
                        key: { remoteJid: normalizeJID(threadID), id: messageID, fromMe: true },
                        type: 1,
                        duration
                    }
                });
            },

            unpinMessage: async (threadID, messageID) => {
                return await sock.sendMessage(normalizeJID(threadID), {
                    pin: {
                        key: { remoteJid: normalizeJID(threadID), id: messageID, fromMe: true },
                        type: 0
                    }
                });
            },

            downloadMedia: async (msgObj) => {
                return await downloadMediaMessage(msgObj, "buffer", {}, { logger: pino({ level: "silent" }) });
            },

            // ─── Extra compatibility methods/aliases ─────────────────────────────
            listenMqtt: (callback) => {
                ctx.listenCallback = callback;
                bindListener(sock, ctx, callback);
                return sock;
            },

            sendPTT: async (buffer, threadID, options = {}) => {
                return await sock.sendMessage(normalizeJID(threadID), { audio: resolveMedia(buffer), ptt: true, mimetype: options.mimetype || "audio/ogg" }, options);
            },

            sendDocument: async (buffer, threadID, fileName, options = {}) => {
                return await sock.sendMessage(normalizeJID(threadID), { document: resolveMedia(buffer), fileName: fileName || "file", mimetype: options.mimetype || "application/pdf" }, options);
            },

            sendSticker: async (buffer, threadID, options = {}) => {
                return await sock.sendMessage(normalizeJID(threadID), { sticker: resolveMedia(buffer) }, options);
            },

            sendGif: async (buffer, threadID, caption, options = {}) => {
                return await sock.sendMessage(normalizeJID(threadID), { video: resolveMedia(buffer), gifPlayback: true, caption }, options);
            },

            sendMedia: async (buffer, threadID, type, caption, options = {}) => {
                const target = normalizeJID(threadID);
                const mediaObj = resolveMedia(buffer);
                if (type === "ptt") {
                    return await sock.sendMessage(target, { audio: mediaObj, ptt: true, mimetype: options.mimetype || "audio/ogg" }, options);
                } else if (type === "gif") {
                    return await sock.sendMessage(target, { video: mediaObj, gifPlayback: true, caption }, options);
                } else {
                    return await sock.sendMessage(target, { [type]: mediaObj, caption }, options);
                }
            },

            markAsRead: async (threadID, participant, messageIds) => {
                return await sock.readMessages([{ remoteJid: normalizeJID(threadID), id: messageIds[0], participant: normalizeJID(participant) }]);
            },

            addUserToGroup: async (threadID, jid) => {
                return await sock.groupParticipantsUpdate(normalizeJID(threadID), [normalizeJID(jid)], "add");
            },

            removeUserFromGroup: async (threadID, jid) => {
                return await sock.groupParticipantsUpdate(normalizeJID(threadID), [normalizeJID(jid)], "remove");
            },

            changeGroupSubject: async (threadID, subject) => {
                return await sock.groupUpdateSubject(normalizeJID(threadID), subject);
            },

            changeGroupDescription: async (threadID, description) => {
                return await sock.groupUpdateDescription(normalizeJID(threadID), description);
            },

            getGroupAdmins: async (threadID) => {
                const metadata = await sock.groupMetadata(normalizeJID(threadID));
                return (metadata.participants || [])
                    .filter(p => p.admin === "admin" || p.admin === "superadmin")
                    .map(p => p.id);
            },

            createGroup: async (title, participants = []) => {
                const normalized = participants.map(p => normalizeJID(p));
                return await sock.groupCreate(title, normalized);
            },

            leaveGroup: async (threadID) => {
                return await sock.groupLeave(normalizeJID(threadID));
            },

            getAllGroups: async () => {
                const chats = sock.chats || {};
                const groups = [];
                for (const jid of Object.keys(chats)) {
                    if (isGroupJID(jid)) {
                        groups.push({ id: jid, name: chats[jid].name || "" });
                    }
                }
                return groups;
            },

            unarchiveChat: async (threadID) => {
                return await sock.chatModify({ archive: false }, normalizeJID(threadID));
            },

            getUserInfo: async (jid) => {
                const target = normalizeJID(jid);
                const contact = sock.contacts?.[target] || {};
                return {
                    id: target,
                    name: contact.name || contact.notify || contact.verifiedName || "",
                    notify: contact.notify || "",
                    verifiedName: contact.verifiedName || ""
                };
            },

            getDMInfo: async (jid) => {
                const target = normalizeJID(jid);
                const contact = sock.contacts?.[target] || {};
                return {
                    id: target,
                    name: contact.name || contact.notify || "",
                };
            },

            getContacts: async () => {
                return Object.values(sock.contacts || {});
            },

            getChats: async () => {
                return Object.values(sock.chats || {});
            },

            sendButtons: async (threadID, text, buttons = [], options = {}) => {
                let formattedText = text;
                if (buttons.length > 0) {
                    formattedText += "\n\n🔘 *Buttons:*";
                    buttons.forEach(btn => {
                        const label = btn.buttonText?.displayText || btn.displayText || btn.id || "";
                        formattedText += `\n- ${label}`;
                    });
                }
                return await sock.sendMessage(normalizeJID(threadID), { text: formattedText }, options);
            },

            sendList: async (threadID, title, buttonText, sections = [], options = {}) => {
                let formattedText = `📋 *${title}*\n${buttonText}`;
                sections.forEach(sec => {
                    if (sec.title) {
                        formattedText += `\n\n🔹 *${sec.title}*`;
                    }
                    if (Array.isArray(sec.rows)) {
                        sec.rows.forEach(row => {
                            formattedText += `\n- *${row.title || ""}*: ${row.description || ""}`;
                        });
                    }
                });
                return await sock.sendMessage(normalizeJID(threadID), { text: formattedText }, options);
            },

            sendTemplate: async (threadID, text, templateButtons = [], options = {}) => {
                let formattedText = text;
                if (templateButtons.length > 0) {
                    formattedText += "\n\n🔗 *Links & Actions:*";
                    templateButtons.forEach(btn => {
                        const type = btn.quickReplyButton ? "Reply" : (btn.urlButton ? "Link" : "Call");
                        const label = btn.quickReplyButton?.displayText || btn.urlButton?.displayText || btn.callButton?.displayText || "";
                        const action = btn.urlButton?.url || btn.callButton?.phoneNumber || "";
                        formattedText += `\n- [${type}] *${label}* ${action ? `(${action})` : ""}`;
                    });
                }
                return await sock.sendMessage(normalizeJID(threadID), { text: formattedText }, options);
            },

            listen: (callback) => {
                ctx.listenCallback = callback;
                bindListener(sock, ctx, callback);
                return sock;
            },
        };


        return api;
    }

    startConnection();
}

module.exports = baileysConnect;
module.exports.normUID = normUID;
module.exports.normalizeJID = normalizeJID;
module.exports.isGroupJID = isGroupJID;
