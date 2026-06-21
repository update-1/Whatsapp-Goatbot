# 🔐 How to Login via Session ID

Welcome to the **Goat-WhatsApp-Bot** login guide! This document explains how to use the `sessionID` feature to connect your bot without scanning a QR code or using a pairing code.

---

## 🚀 Quick Steps to Login

Using a **Session ID** is the fastest way to get your bot online, especially if you are deploying to a server (like Heroku, Replit, or VPS).

1.  **Get your Session ID**: Obtain a session ID from the **Pair_Code-main** session generator included in this project, or any KnightBot-compatible generator.
2.  **Open `config.json`**: Locate the `config.json` file in the root directory of the bot.
3.  **Find `sessionID`**: Search for the `"sessionID": ""` field.
4.  **Paste your ID**: Paste your session ID between the quotes.
    ```json
    "sessionID": "YOUR_SESSION_ID_HERE",
    ```
5.  **Save and Run**: Save the file and start your bot using `npm start`.

> **Alternative — Environment Variable**: On cloud platforms (Heroku, Render, Railway), set `SESSION_ID` as an environment variable instead of editing `config.json`. The bot prioritizes the env variable.

---

## 🛠️ Supported Session Formats

The bot is highly compatible and supports multiple session formats:

| Format Type | Description |
| :--- | :--- |
| **Mega.nz URL** | A direct link to your session file hosted on Mega.nz (e.g., `https://mega.nz/file/...`). |
| **Base64 String** | A base64 encoded version of your `creds.json` file. |
| **KnightBot Format** | Specialized format starting with `KnightBot!` or containing `~`. |
| **Compressed Data** | Zlib compressed session data. |

---

## 💡 Important Notes

> [!IMPORTANT]
> **One-Time Import**: Once the bot successfully imports your session ID, it will automatically clear the `sessionID` field in `config.json` and save the credentials to the `session/` folder. This is a security feature to prevent re-importing on every restart.

> [!TIP]
> **Cloud Environment**: If you are using a cloud platform, you can also set an environment variable named `SESSION_ID` instead of editing `config.json`. The bot will prioritize the environment variable.

> [!WARNING]
> **Stay Secure**: Never share your Session ID with anyone. It contains your account's private keys and allows anyone to control your WhatsApp account through the bot.

---

## 👨‍💻 Developer Guide: How it Works

This bot implements the sessionID system directly in [`bot/login/login.js`](file:///e:/Rasel/New%20folder/1Whatsapp%20Goatbot/bot/login/login.js) via the `checkAndImportSession()` function, which runs automatically at **Step 2** of the startup sequence — before the WhatsApp connection is established.

### 1. The Implementation (in this project)

The `checkAndImportSession()` function in `bot/login/login.js`:

```javascript
const zlib = require('zlib');

async function checkAndImportSession() {
  const cfg       = global.GoatBot.config;
  const sessionId = (process.env.SESSION_ID || cfg.sessionID || "").trim();

  if (!sessionId) return false;

  const authFolder = path.resolve(process.cwd(), cfg.authFolder || "./auth");

  let sessionData = null;
  let url = sessionId;

  // Format 1: KnightBot! (zlib compressed + base64)
  if (url.startsWith("KnightBot!")) {
    const decompressed = zlib.unzipSync(Buffer.from(url.substring(10), "base64"));
    sessionData = decompressed;
  }

  // Format 2: KnightBot ~ separator
  else if (url.includes("~")) {
    const b64 = url.split("~")[1] || url.split("~")[0];
    try { url = Buffer.from(b64, "base64").toString("utf8"); } catch (_) {}
  }

  // Format 3: Mega.nz URL
  if (!sessionData && url.startsWith("http") && url.includes("mega.nz")) {
    const mega = require("megajs");
    const file = mega.File.fromURL(url);
    await file.loadAttributes();
    sessionData = await file.downloadBuffer();
  }

  // Format 4: Plain Base64 JSON
  if (!sessionData && !url.startsWith("http")) {
    const decoded = Buffer.from(url, "base64").toString("utf8");
    JSON.parse(decoded); // validate
    sessionData = Buffer.from(decoded, "utf8");
  }

  if (sessionData) {
    fs.mkdirSync(authFolder, { recursive: true });
    fs.writeFileSync(path.join(authFolder, "creds.json"), sessionData);
    // Clear from config.json for security
    cfg.sessionID = "";
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    return true;
  }
}
```

### 2. Startup Flow
```
npm start
  └─ index.js → ST.js → bot/login/login.js
       Step 1: Load config.json
       Step 2: checkAndImportSession()   ← reads sessionID
               └─ writes creds.json to ./auth/
               └─ clears sessionID from config.json
               connect() → WhatsApp
       Step 3–7: Database, Scripts, Express, Ready
```

### 3. Session Generator (Pair_Code-main)
The [`Pair_Code-main/`](file:///e:/Rasel/New%20folder/1Whatsapp%20Goatbot/Pair_Code-main) sub-project is a standalone Express server that:
- Accepts a phone number via `/pair?number=XXXX`
- Generates a WhatsApp pairing code
- On successful pairing, creates a `KnightBot!` format session ID (gzip+base64 of `creds.json`)
- Sends the session ID to your WhatsApp number

To use the generator:
```bash
cd Pair_Code-main
npm install
npm start
# Opens on http://localhost:8000
```

### 4. Why This Works
1.  **Format Detection**: Automatically detects KnightBot!, `~` separator, Mega.nz URL, or plain Base64.
2.  **Auto-Cleanup**: After import, `sessionID` is cleared from `config.json` — no re-import on restart.
3.  **Auth Priority**: If `./auth/creds.json` already exists, session import is skipped entirely.
4.  **Env Variable**: `SESSION_ID` env var takes priority over `config.json` — perfect for cloud deployments.

---

*Made with ♡ by the GoatBot Team*
