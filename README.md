# Whatsapp-Goatbot

> A powerful, event-driven WhatsApp bot built on **@whiskeysockets/baileys** with an FCA-compatible API layer.

[![Generate Pair Code](https://img.shields.io/badge/Generate%20Pair%20Code-Click%20Here-brightgreen?style=for-the-badge)](https://romeobot-paircode.vercel.app/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=node.js)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

---

## 🚀 Quick Start

```bash
git clone https://github.com/mdraselm325/Whatsapp-Goatbot.git
cd Whatsapp-Goatbot
npm install
npm start
```

The bot will print a **Pairing Code** in your terminal. Open WhatsApp → Linked Devices → Link a Device → enter the code.

---

## 🔐 Session Login

> ⭐ **Recommended: Use Method 3 (Session ID)** — easiest, no terminal interaction needed.

---

### Method 1 — Pair Code (Terminal)

Set your phone number in `config.json`:

```json
{
  "phoneNumber": "8801XXXXXXXXX",
  "loginMode": "pair"
}
```

Run the bot:

```bash
npm start
```

The bot will print an **8-digit pairing code** in the terminal like this:

```
Pairing Code: ABCD-1234
```

Then on your phone:
1. Open **WhatsApp**
2. Go to ⋮ → **Linked Devices**
3. Tap **Link a Device**
4. Tap **Link with phone number instead**
5. Enter the code shown in your terminal

---

### Method 2 — QR Code

```json
{
  "loginMode": "qr"
}
```

Run `npm start` — a QR code will appear in the terminal. Scan it with WhatsApp → Linked Devices → Link a Device.

---

### Method 3 — Session ID ⭐ Recommended

[![Generate Session](https://img.shields.io/badge/Generate%20Session%20ID-Click%20Here-brightgreen?style=for-the-badge)](https://romeobot-paircode.vercel.app/)

1. Visit **[romeobot-paircode.vercel.app](https://romeobot-paircode.vercel.app/)**
2. Enter your phone number and generate a session
3. Copy the session string
4. Paste it into `config.json`:

```json
{
  "sessionID": "YOUR_SESSION_STRING_HERE",
  "loginMode": "pair"
}
```

5. Run `npm start` — the bot logs in automatically, no terminal code needed!

> **How it works:**
> - On startup the bot reads `sessionID` from `config.json` (or the `SESSION_ID` env variable).
> - It imports the credentials into the `authFolder` automatically.
> - After a successful import, `sessionID` is **cleared from `config.json`** for security — the saved auth files take over from then on.
> - Perfect for cloud deployments (Heroku, Railway, Render, etc.) where you can't interact with the terminal.

You can also set it via environment variable:

```bash
SESSION_ID=YOUR_SESSION_STRING
```

---


## ⚙️ Configuration

Main config file: `config.json`

```json
{
  "prefix": "!",
  "botName": "Whatsapp-Goatbot",
  "language": "en",
  "adminBot": ["your_whatsapp_id"],
  "phoneNumber": "8801XXXXXXXXX",
  "loginMode": "pair",
  "sessionID": "",
  "authFolder": "./auth",
  "database": {
    "type": "json"
  },
  "listen": {
    "selfListen": false,
    "listenEvents": true
  },
  "featureBox": {
    "adminOnly": false,
    "antiInbox": false,
    "unsendBotReact": true
  }
}
```

| Field | Description |
|---|---|
| `prefix` | Global command trigger character (e.g. `!`) |
| `botName` | Bot display name |
| `adminBot` | Array of WhatsApp IDs with bot-admin rights |
| `phoneNumber` | Your WA number with country code (no `+`) |
| `loginMode` | `pair` or `qr` |
| `sessionID` | Paste session string here for one-time import (auto-cleared after use) |
| `authFolder` | Where session credentials are saved |
| `database.type` | `json` or `mongodb` |
| `listen.selfListen` | Bot listens to its own messages |
| `listen.listenEvents` | Enables group event listening |
| `featureBox.adminOnly` | Restricts commands to admins only |
| `featureBox.antiInbox` | Bot ignores private/DM messages |
| `featureBox.unsendBotReact` | Delete bot message by reacting |

---

## 📁 Project Structure

```text
Whatsapp-Goatbot/
├── Goat.js                  ← Main entry point
├── index.js                 ← Process manager / auto-restart
├── config.json
├── bot/
│   ├── handler/
│   │   ├── handlerEvent.js
│   │   ├── handlerAction.js
│   │   └── handletCheckData.js
│   └── login/
│       ├── baileys.js       ← Baileys adapter & API builder
│       └── login.js         ← Bot startup logic
├── database/
│   ├── controller/
│   └── json/
├── scripts/
│   ├── cmds/                ← Command files
│   └── events/              ← Event listener files
├── logger/
│   └── colors.js
└── utils.js
```

---

## 🤖 Writing Commands

Place command files in `scripts/cmds/`.

```js
"use strict";

module.exports = {
  config: {
    name: "ping",
    version: "1.0.0",
    author: "YourName",
    countDown: 3,       // cooldown in seconds
    role: 0,            // 0 = everyone, 1 = group admin, 2 = bot admin
    shortDescription: "Check bot latency",
    category: "system",
    guide: { en: "{pn}" }
  },

  onStart: async ({ api, event, args, message }) => {
    return message.reply("🏓 Pong!");
  }
};
```

### Command Hooks

| Hook | When it fires |
|---|---|
| `onStart` | User sends `!commandName` |
| `onChat` | Every message (no prefix needed) |
| `onReply` | User replies to a registered bot message |
| `onReaction` | User reacts to a registered bot message |

---

## 📨 Message Helper (`message`)

```js
await message.reply("Text");
await message.send("Text", threadID);
await message.react("👍");
await message.unsend(messageID);
await message.edit(messageID, "New text");
await message.typing();          // shows typing indicator
```

### Sending Media

```js
// Image
await message.reply({
  body: "Caption here",
  attachment: { type: "image", url: "https://example.com/photo.jpg" }
});

// Video
await message.reply({
  body: "Caption",
  attachment: { type: "video", url: "https://example.com/clip.mp4" }
});

// Audio (voice note)
await message.reply({
  attachment: { type: "ptt", url: "https://example.com/audio.ogg" }
});

// Document
await message.reply({
  body: "Here is a file",
  attachment: {
    type: "document",
    url: "https://example.com/file.pdf",
    mimetype: "application/pdf",
    fileName: "file.pdf"
  }
});

// Sticker
await message.reply({
  attachment: { type: "sticker", url: "https://example.com/sticker.webp" }
});
```

---

## 📡 onReply & onReaction

### Register a reply listener

```js
const info = await message.reply("Reply with a number:");

global.GoatBot.onReply.set(info.messageID, {
  commandName: "choose",
  author: event.senderID,
  data: ["Option A", "Option B", "Option C"]
});
```

### Handle the reply

```js
onReply: async ({ event, Reply, message }) => {
  if (event.senderID !== Reply.author) return;
  await message.reply(`You chose: ${Reply.data[event.body - 1]}`);
}
```

### Register a reaction listener

```js
global.GoatBot.onReaction.set(info.messageID, {
  commandName: "vote",
  author: event.senderID
});
```

```js
onReaction: async ({ event, Reaction, message }) => {
  await message.reply(`You reacted: ${event.emoji}`);
}
```

---

## 📅 Writing Events

Place event files in `scripts/events/`.

```js
"use strict";

module.exports = {
  config: {
    name: "welcome",
    version: "1.0.0",
    author: "YourName",
    category: "events"
  },

  onStart: async ({ api, event }) => {
    if (event.logMessageType === "log:subscribe") {
      for (const uid of event.participants) {
        await api.sendMessage(`👋 Welcome to the group!`, event.threadID);
      }
    }
  }
};
```

### Supported Event Types

| `event.type` | Description |
|---|---|
| `message` | Regular chat message |
| `message_reaction` | User adds/removes a reaction |
| `event` | Group participant change |
| `group_update` | Group name or settings changed |

### Group Log Types (`event.logMessageType`)

| Value | Trigger |
|---|---|
| `log:subscribe` | User(s) joined a group |
| `log:unsubscribe` | User(s) left or were removed |
| `log:thread-admins` | Admin promoted / demoted |
| `log:thread-name` | Group name was changed |

---

## 🔌 Baileys API Reference

All commands and events receive an `api` object with these methods:

### Messaging

```js
api.sendMessage(content, threadID)
api.sendImage(buffer, threadID, caption, options)
api.sendVideo(buffer, threadID, caption, options)
api.sendAudio(buffer, threadID, options)
api.sendPTT(buffer, threadID, options)          // voice note
api.sendDocument(buffer, threadID, fileName, options)
api.sendSticker(buffer, threadID, options)
api.sendGif(buffer, threadID, caption, options)
api.sendMedia(buffer, threadID, type, caption, options)
api.sendLocation(threadID, latitude, longitude, options)
api.sendPoll(threadID, question, options)
api.sendButtons(threadID, text, buttons, options)
api.sendList(threadID, title, buttonText, sections, options)
```

### Message Actions

```js
api.reactToMessage(threadID, key, emoji)
api.deleteMessage(threadID, key, forEveryone)
api.editMessage(threadID, messageID, newText)
api.pinMessage(threadID, messageID, duration)
api.unpinMessage(threadID, messageID)
api.downloadMedia(messageObject)
```

### Group Management

```js
api.getGroupInfo(threadID)
api.getGroupInviteLink(threadID)
api.groupRevokeInvite(threadID)
api.groupAcceptInvite(code)
api.groupSettingUpdate(threadID, setting, value)
api.kickUser(threadID, jids)
api.promoteAdmin(threadID, jids)
api.demoteAdmin(threadID, jids)
api.getGroupAdmins(threadID)
api.createGroup(title, participants)
api.leaveGroup(threadID)
api.getAllGroups()
api.addUserToGroup(threadID, jid)
api.removeUserFromGroup(threadID, jid)
api.changeGroupSubject(threadID, subject)
api.changeGroupDescription(threadID, description)
```

### User & Profile

```js
api.getCurrentUserID()
api.getUserInfo(jid)
api.getDMInfo(jid)
api.getContacts()
api.getChats()
api.getProfilePicture(jid)
api.updateProfilePicture(buffer)
api.updateProfileStatus(status)
api.updateProfileName(name)
api.fetchStatus(jid)
```

### Presence & Receipts

```js
api.sendTypingIndicator(threadID, duration)
api.sendPresenceUpdate(jid, presence)
api.sendReadReceipt(threadID, participant, messageIds)
api.markAsRead(threadID, participant, messageIds)
```

### Chat Moderation

```js
api.muteChat(threadID, duration)
api.unmuteChat(threadID)
api.archiveChat(threadID, archive)
api.unarchiveChat(threadID)
api.pinChat(threadID, pin)
api.blockContact(jid)
api.unblockContact(jid)
```

---

## 🗄️ Database

JSON files are stored at:

```text
database/json/userData.json
database/json/threadsData.json
database/json/globalData.json
```

Access in commands:

```js
const user   = await userData(event.senderID);
const thread = await threadsData(event.threadID);

// or via global
const user   = await global.GoatBot.DB.userData(event.senderID);
```

---

## 🌐 Useful Globals

```js
global.GoatBot.cmds          // loaded commands map
global.GoatBot.events        // loaded events map
global.GoatBot.onReply       // active reply listeners (Map)
global.GoatBot.onReaction    // active reaction listeners (Map)
global.GoatBot.config        // parsed config.json
global.GoatBot.DB            // database controllers

global.buildMessage
global.getTargetUser
global.getMessageReply
global.resolveUserDisplayName
global.humanDuration
global.sleep
```

---

## 🔄 Command & Event Manager (`!cmd`)

> Alias: `!command` — Role: **Bot Admin only**

Manage commands and events **live, without restarting the bot**.

### Subcommands

| Subcommand | Usage | Description |
|---|---|---|
| `install` | `!cmd install <file.js> <url>` | Download & install a command from a raw URL |
| `install` | `!cmd install <file.js>` + paste code | Install from code pasted in the same message or as a reply |
| `loadall` | `!cmd loadall` | Reload **every** `.js` file in `scripts/cmds/` at once |
| `load` | `!cmd load <name>` | Load / enable a single command from disk |
| `unload` | `!cmd unload <name>` | Disable a command (removed from memory, **file kept**) |
| `reload` | `!cmd reload <name>` | Unload + re-load a command (picks up code changes) |

### Examples

```text
# Install from a raw GitHub URL
!cmd install weather.js https://raw.githubusercontent.com/.../weather.js

# Install by pasting code directly
!cmd install ping.js
<paste your JS code here in the same message>

# Reload all commands at once
!cmd loadall

# Enable / disable / refresh a single command
!cmd load   ping
!cmd unload ping
!cmd reload ping
```

> **Overwrite protection:** If `install` targets a file that already exists, the bot asks you to **react** to confirm before overwriting.

---

### Event Management (`!event`)

| Subcommand | Usage | Description |
|---|---|---|
| `load` | `!event load <name>` | Load / enable an event listener |
| `unload` | `!event unload <name>` | Disable an event listener (file kept) |
| `reload` | `!event reload <name>` | Reload an event listener |

```text
!event load   welcome
!event unload welcome
!event reload welcome
```

---

## ♻️ Auto-Restart

The bot uses a **process manager** (`index.js`) that automatically restarts the bot child process:

- Exit code `1` → restarts after **3 seconds** (crash recovery)
- Exit code `2` → restarts **immediately** (clean reconnection after WA disconnect)

---

## 📜 License

Use and modify freely with credit to the original authors.
#   W h a t s a p p - G o a t b o t  
 