"use strict";

const axios = require("axios");
const fs = require("fs-extra");
const { execSync } = require("child_process");
const path = require("path");
const { normUID } = require("../../bot/login/baileys.js");

const repoOwner = "update-1";
const repoName = "Whatsapp-Goatbot";
const repoBranch = "main";
const baseUrl = `https://raw.githubusercontent.com/${repoOwner}/${repoName}/${repoBranch}`;

module.exports = {
	config: {
		name: "update",
		version: "2.0",
		author: "Rômeo",
		role: 2,
		shortDescription: {
			en: "Check for and install updates",
			vi: "Kiểm tra và cài đặt bản cập nhật"
		},
		category: "owner",
		guide: {
			en: "{pn}",
			vi: "{pn}"
		}
	},

	// ── onStart: check for updates and prompt user to react ──────────────────
	onStart: async function ({ message, event }) {
		try {
			const { data: remotePkg } = await axios.get(`${baseUrl}/package.json`, { timeout: 15000 });
			const { data: versions } = await axios.get(`${baseUrl}/versions.json`, { timeout: 15000 });

			// Clear require cache so we always get the real current version
			delete require.cache[require.resolve("../../package.json")];
			const currentVersion = require("../../package.json").version;

			if (compareVersion(remotePkg.version, currentVersion) < 1)
				return message.reply(`✅ You are using the latest version (v${currentVersion}).`);

			const newVersions = versions.slice(versions.findIndex(v => v.version === currentVersion) + 1);

			let filesUpdate = [...new Set(newVersions.map(v => Object.keys(v.files || {})).flat())]
				.sort()
				.filter(f => f?.length);
			const totalUpdate = filesUpdate.length;
			const displayUpdate = filesUpdate.slice(0, 10).map(f => ` - ${f}`).join("\n");

			let filesDelete = [...new Set(newVersions.map(v => Object.keys(v.deleteFiles || {})).flat())]
				.sort()
				.filter(f => f?.length);
			const totalDelete = filesDelete.length;
			const displayDelete = filesDelete.slice(0, 10).map(f => ` - ${f}`).join("\n");

			const msg =
				`💫 New version v${remotePkg.version} available (current: v${currentVersion})\n\n` +
				`⬆️ Files to update:\n${displayUpdate}${totalUpdate > 10 ? `\n ...and ${totalUpdate - 10} more` : ""}` +
				(totalDelete > 0 ? `\n\n🗑️ Files to delete:\n${displayDelete}${totalDelete > 10 ? `\n ...and ${totalDelete - 10} more` : ""}` : "") +
				"\n\n💡 React to this message to confirm update.";

			// ── await-based (WhatsApp bot uses Promise API, not callbacks) ────
			const info = await message.reply(msg);
			if (!info || !info.messageID) return;

			// ── commandName hardcoded: handler doesn't inject it into onStart ─
			global.GoatBot.onReaction.set(info.messageID, {
				commandName: "update",
				messageID: info.messageID,
				threadID: info.threadID,
				authorID: event.senderID
			});
		} catch (err) {
			message.reply(`❌ Error checking updates: ${err.message}`);
		}
	},

	// ── onReaction: confirmed — run updater ──────────────────────────────────
	onReaction: async function ({ message, event, Reaction }) {
		// normUID handles JID format differences (e.g. :40@s.whatsapp.net vs plain number)
		if (normUID(event.senderID) !== normUID(Reaction.authorID)) return;

		await message.react("⏳");
		await message.reply("🚀 Confirmed, updating...");

		try {
			execSync("node update.js", { cwd: path.resolve(__dirname, "../.."), stdio: "inherit" });

			// ── await-based + commandName hardcoded ───────────────────────────
			const info = await message.reply(
				"✅ Update complete!\n\n🔄 *Quote-reply* this message with *yes* or *y* to restart the bot now."
			);
			if (!info || !info.messageID) return;

			global.GoatBot.onReply.set(info.messageID, {
				commandName: "update",
				messageID: info.messageID,
				threadID: event.threadID,
				authorID: event.senderID
			});
		} catch (err) {
			message.reply(`❌ Update failed: ${err.message}`);
		}
	},

	// ── onReply: quote-reply "yes" or "y" to restart ─────────────────────────
	onReply: async function ({ message, event, Reply }) {
		if (normUID(event.senderID) !== normUID(Reply.authorID)) return;

		const answer = (event.body || "").trim().toLowerCase();
		if (answer !== "yes" && answer !== "y") return;

		const CACHE_DIR = path.resolve(process.cwd(), "cache");
		const RESTART_FILE = path.join(CACHE_DIR, "restart.txt");
		if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

		const data = { time: Date.now(), threads: [event.threadID], sender: event.senderID };
		fs.writeFileSync(RESTART_FILE, JSON.stringify(data), "utf8");

		await message.reply("🔄 Restarting bot now…");
		setTimeout(() => process.exit(2), 2000);
	}
};

function compareVersion(v1, v2) {
	const a = String(v1).split(".").map(Number);
	const b = String(v2).split(".").map(Number);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		if ((a[i] || 0) > (b[i] || 0)) return 1;
		if ((a[i] || 0) < (b[i] || 0)) return -1;
	}
	return 0;
}
