# Updater System - How It Works

The GoatBot-V2 update system consists of four key files that work together to provide automatic updates:

## 1. `update.js` - Entry Point

```js
const axios = require('axios');
axios.get("https://raw.githubusercontent.com/ntkhang03/Goat-Bot-V2/main/updater.js")
    .then(res => eval(res.data));
```

- Fetches the **latest `updater.js`** from the GitHub repository and executes it via `eval()`.
- This ensures the updater itself is always up-to-date before performing any update.

## 2. `updater.js` - The Core Updater

This is the main update engine. It:

1. **Checks update timing** - Ensures at least 5 minutes have passed since the latest commit to prevent rapid updates.
2. **Fetches `versions.json`** from GitHub and compares your current version (from `package.json`) against the list.
3. **Merges update data** - Collects all versions newer than your current one and merges their `files`, `deleteFiles`, and `reinstallDependencies` flags.
4. **Downloads & applies updates** - For each file listed in the update:
   - **`config.json` / `configCommands.json`**: Merges new keys/values into your existing config without overwriting user settings. Uses `sortObj()` to maintain key ordering.
   - **Other files**: Downloads from GitHub raw. Backs up the existing file to `backups/backup_<oldVersion>/`. Skips files whose first line contains `"DO NOT UPDATE"`, `"SKIP UPDATE"`, or `"DO NOT UPDATE THIS FILE"`.
5. **Deletes files** listed in `deleteFiles` (with backup).
6. **Updates `package.json`** from GitHub.
7. **Runs `npm install`** if `reinstallDependencies` is `true`.
8. **Manages backups** - Moves old backup folders into `backups/`.

## 3. `versions.json` - Version Manifest

This file (stored locally and on GitHub) is an ordered array of version objects:

```json
[
  {
    "version": "1.0.1",
    "files": {
      "bot/login/login.js": "fixes terminal freeze"
    }
  },
  {
    "version": "1.0.4",
    "files": {
      "bot/login/login.js": "fixes bugs",
      "scripts/cmds/badwords.js": "fixes error..."
    },
    "deleteFiles": {
      "scripts/cmds/instagram.js": "api is no longer working"
    },
    "reinstallDependencies": true
  }
]
```

- Each entry has a `version` string and `files` object (file paths mapped to descriptions).
- Optionally includes `deleteFiles` (files to remove) and `reinstallDependencies` (triggers `npm install`).
- The updater compares your current version against this list and applies all pending versions in sequence.

## 4. `bot/login/login.js` - Bot Login & Runtime

This file is the **most frequently updated file** in the project. It:

1. **Displays the logo, version, and copyright info** in the terminal.
2. **Handles authentication** - Reads credentials from `account.txt` (supports tokens, cookie strings, Netscape cookies, JSON appstate, or email/password).
3. **Interactive login** - If no valid credentials are found, it shows an interactive menu to choose login method.
4. **2FA support** - Handles two-factor authentication via TOTP or QR code.
5. **Logs into Facebook** using the `fb-chat-api` (FCA) package with the obtained appstate.
6. **Checks Gban (Global Ban)** - Fetches a ban list from GitHub and exits if the bot or its admin is banned.
7. **Loads data** (threads, users, dashboard, global) and **loads scripts** (commands & events).
8. **Starts listening** for messages via MQTT with auto-reconnect logic.
9. **Auto-refreshes cookies** at configurable intervals if email/password is provided.
10. **Optional uptime server** and **auto-restart** for listenMqtt.

## How They Work Together

```
node update.js
      │
      ▼
  Fetches latest updater.js from GitHub
      │
      ▼
  updater.js runs:
      │
      ├── Checks timing (≥5 min after last commit)
      ├── Fetches versions.json from GitHub
      ├── Compares local version vs remote
      │
      ├── For each pending version:
      │   ├── Downloads updated files from GitHub raw
      │   ├── Backs up old files to backups/
      │   ├── Updates config files (merge, not overwrite)
      │   ├── Deletes deprecated files
      │   └── Runs npm install if needed
      │
      └── Updates package.json, saves versions.json locally
      
login.js  (may be updated by updater)
      │
      ├── Reads account.txt (token/cookie/email)
      ├── Interactive login menu (if no valid credentials)
      ├── Logs into Facebook via fb-chat-api
      ├── Checks Gban
      ├── Loads database & scripts
      └── Starts MQTT listener
```

The updater ensures `login.js` (and all other files) stay current by downloading the latest versions from GitHub, while `login.js` itself handles the actual Facebook connection and bot runtime.
