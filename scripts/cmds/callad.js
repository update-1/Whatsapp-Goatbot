"use strict";

const langs = {
  en: {
    missingMessage: "Please enter the message you want to send to admin",
    sendByGroup: "\n- Sent from group: %1\n- Thread ID: %2",
    sendByUser: "\n- Sent from user",
    content: "\n\nContent:\n─────────────────\n%1\n─────────────────\nReply this message to send message to user",
    success: "Sent your message to %1 admin successfully!\n%2",
    failed: "An error occurred while sending your message to %1 admin\n%2\nCheck console for more details",
    reply: "📍 Reply from admin %1:\n─────────────────\n%2\n─────────────────\nReply this message to continue send message to admin",
    replySuccess: "Sent your reply to admin successfully!",
    feedback: "📝 Feedback from user %1:\n- User ID: %2%3\n\nContent:\n─────────────────\n%4\n─────────────────\nReply this message to send message to user",
    replyUserSuccess: "Sent your reply to user successfully!",
    noAdmin: "Bot has no admin at the moment"
  }
};

function getLang(key, ...params) {
  const langCode = global.ST?.config?.language || "en";
  const langObj = langs[langCode] || langs.en;
  let text = langObj[key] || langs.en[key] || "";
  for (let i = 0; i < params.length; i++) {
    text = text.replace(new RegExp(`%${i + 1}`, "g"), params[i]);
  }
  return text;
}

async function resolveAdminJID(api, uid) {
  if (!uid) return "";
  if (uid.includes("@")) return uid;

  const bare = uid.split(":")[0].split("@")[0];

  try {
    const sock = api.sock;
    if (sock && sock.contacts) {
      const phoneKey = bare + "@s.whatsapp.net";
      const lidKey = bare + "@lid";
      if (sock.contacts[lidKey]) return lidKey;
      if (sock.contacts[phoneKey]) return phoneKey;
    }
  } catch (_) { }

  // Check database records
  try {
    const allUsers = await global.ST.DB.users.getAll();
    const keys = Object.keys(allUsers || {});
    const lidKey = bare + "@lid";
    const phoneKey = bare + "@s.whatsapp.net";
    if (keys.includes(lidKey)) return lidKey;
    if (keys.includes(phoneKey)) return phoneKey;
  } catch (_) { }

  return bare + "@s.whatsapp.net";
}

module.exports = {
  config: {
    name: "callad",
    version: "2.8",
    author: "Rômeo",
    countDown: 5,
    role: 0,
    shortDescription: "send report, feedback, bug,... to admin bot",
    longDescription: "send report, feedback, bug,... to admin bot",
    category: "contacts admin",
    guide: {
      en: "   {pn} <message>"
    }
  },

  onStart: async function ({ args, message, event, userData, threadsData, api }) {
    const adminBot = global.ST?.config?.adminBot || [];
    if (!args[0]) {
      return message.reply(getLang("missingMessage"));
    }
    if (adminBot.length === 0) {
      return message.reply(getLang("noAdmin"));
    }

    const resolvedAdminBot = await Promise.all(
      adminBot.map(async uid => await resolveAdminJID(api, uid))
    );

    const senderID = event.senderID;
    const { threadID, isGroup } = event;

    const senderName = await global.getDisplayName(senderID);
    const senderNum = global.utils.jidToPhone(senderID);

    let threadName = "Unknown Group";
    if (isGroup) {
      try {
        const thread = await threadsData(threadID);
        threadName = thread.name || "Unknown Group";
      } catch (_) { }
    }

    const msg = "==📨️ CALL ADMIN 📨️=="
      + `\n- User Name: ${senderName}`
      + `\n- User ID: @${senderNum}`
      + (isGroup ? getLang("sendByGroup", threadName, threadID) : getLang("sendByUser"));

    const att = await global.utils.getAttachmentStream({ event, api });

    const formMessage = {
      body: msg + getLang("content", args.join(" ")),
      mentions: [senderID]
    };

    if (att && att.stream) {
      let type = att.mimetype.split("/")[0];
      if (type === "application") type = "document";
      else if (type === "audio" && att.mimetype.includes("opus")) type = "ptt";

      const validTypes = ["image", "video", "audio", "ptt", "document", "sticker"];
      if (validTypes.includes(type)) {
        formMessage.attachment = {
          type,
          stream: att.stream,
          mimetype: att.mimetype
        };
      }
    }

    const successIDs = [];
    const failedIDs = [];
    const adminNames = await Promise.all(resolvedAdminBot.map(async item => ({
      id: item,
      name: await global.getDisplayName(item)
    })));

    for (const uid of resolvedAdminBot) {
      if (!uid || uid === "@s.whatsapp.net" || uid === "@lid") continue;
      try {
        const messageSend = await api.sendMessage(formMessage, uid);
        const sentID = messageSend?.key?.id || messageSend?.id || (Array.isArray(messageSend) && messageSend[0]?.key?.id) || null;
        if (sentID) {
          successIDs.push(uid);
          global.ST.onReply.set(sentID, {
            commandName: "callad",
            messageID: sentID,
            threadID,
            messageIDSender: event.messageID,
            senderID,
            type: "userCallAdmin"
          });
        } else {
          failedIDs.push({
            adminID: uid,
            error: new Error("Failed to get message ID from send response.")
          });
        }
      } catch (err) {
        failedIDs.push({
          adminID: uid,
          error: err
        });
      }
    }

    let msg2 = "";
    const mentionJIDs = [];

    if (successIDs.length > 0) {
      const succNamesList = adminNames
        .filter(item => successIDs.includes(item.id))
        .map(item => {
          mentionJIDs.push(item.id);
          return ` @${global.utils.jidToPhone(item.id)} (${item.name})`;
        })
        .join("\n");
      msg2 += getLang("success", successIDs.length, succNamesList);
    }

    if (failedIDs.length > 0) {
      if (msg2) msg2 += "\n\n";
      const failNamesList = failedIDs
        .map(item => {
          const adm = adminNames.find(a => a.id === item.adminID);
          mentionJIDs.push(item.adminID);
          return ` @${global.utils.jidToPhone(item.adminID)} (${adm ? adm.name : item.adminID})`;
        })
        .join("\n");
      msg2 += getLang("failed", failedIDs.length, failNamesList);
      global.log.err("CALL ADMIN", failedIDs);
    }

    if (msg2) {
      return message.reply({
        body: msg2,
        mentions: mentionJIDs
      });
    }
  },

  onReply: async ({ args, event, api, message, Reply, userData, threadsData }) => {
    const { type, threadID, messageIDSender, senderID } = Reply;
    const senderName = await global.getDisplayName(event.senderID);
    const senderNum = global.utils.jidToPhone(event.senderID);
    const { isGroup } = event;

    switch (type) {
      case "userCallAdmin": {
        const att = await global.utils.getAttachmentStream({ event, api });
        const formMessage = {
          body: getLang("reply", `@${senderNum}`, args.join(" ")),
          mentions: [event.senderID]
        };

        if (att && att.stream) {
          let mType = att.mimetype.split("/")[0];
          if (mType === "application") mType = "document";
          else if (mType === "audio" && att.mimetype.includes("opus")) mType = "ptt";

          const validTypes = ["image", "video", "audio", "ptt", "document", "sticker"];
          if (validTypes.includes(mType)) {
            formMessage.attachment = {
              type: mType,
              stream: att.stream,
              mimetype: att.mimetype
            };
          }
        }

        const quoteObj = {
          key: {
            id: messageIDSender,
            remoteJid: threadID,
            fromMe: false,
            participant: senderID
          },
          message: {
            conversation: ""
          }
        };

        try {
          const info = await api.sendMessage(formMessage, threadID, { replyToMessage: quoteObj });
          await message.reply(getLang("replyUserSuccess"));

          const infoID = info?.key?.id || info?.id || (Array.isArray(info) && info[0]?.key?.id) || null;
          if (infoID) {
            global.ST.onReply.set(infoID, {
              commandName: "callad",
              messageID: infoID,
              messageIDSender: event.messageID,
              threadID: event.threadID,
              senderID: event.senderID,
              type: "adminReply"
            });
          }
        } catch (err) {
          await message.reply("❌ Failed to send reply to user: " + err.message);
        }
        break;
      }

      case "adminReply": {
        let sendByGroup = "";
        if (isGroup) {
          let threadName = "Unknown Group";
          try {
            const thread = await threadsData(event.threadID);
            threadName = thread.name || "Unknown Group";
          } catch (_) { }
          sendByGroup = getLang("sendByGroup", threadName, event.threadID);
        }

        const att = await global.utils.getAttachmentStream({ event, api });
        const formMessage = {
          body: getLang("feedback", senderName, `@${senderNum}`, sendByGroup, args.join(" ")),
          mentions: [event.senderID]
        };

        if (att && att.stream) {
          let mType = att.mimetype.split("/")[0];
          if (mType === "application") mType = "document";
          else if (mType === "audio" && att.mimetype.includes("opus")) mType = "ptt";

          const validTypes = ["image", "video", "audio", "ptt", "document", "sticker"];
          if (validTypes.includes(mType)) {
            formMessage.attachment = {
              type: mType,
              stream: att.stream,
              mimetype: att.mimetype
            };
          }
        }

        // Construct a fully valid message key including participant (required for both DM and group quotes in WA clients)
        const quoteObj = {
          key: {
            id: messageIDSender,
            remoteJid: threadID,
            fromMe: false,
            participant: senderID
          },
          message: {
            conversation: ""
          }
        };

        try {
          const info = await api.sendMessage(formMessage, threadID, { replyToMessage: quoteObj });
          await message.reply(getLang("replySuccess"));

          const infoID = info?.key?.id || info?.id || (Array.isArray(info) && info[0]?.key?.id) || null;
          if (infoID) {
            global.ST.onReply.set(infoID, {
              commandName: "callad",
              messageID: infoID,
              messageIDSender: event.messageID,
              threadID: event.threadID,
              senderID: event.senderID,
              type: "userCallAdmin"
            });
          }
        } catch (err) {
          await message.reply("❌ Failed to send feedback to admin: " + err.message);
        }
        break;
      }

      default:
        break;
    }
  }
};
