const axios = require("axios");
const fs = require("fs-extra");
const { execSync } = require("child_process");
const path = require("path");

const repoOwner = "update-1";
const repoName = "Whatsapp-Goatbot";
const repoBranch = "main";
const baseUrl = `https://raw.githubusercontent.com/${repoOwner}/${repoName}/${repoBranch}`;
const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}`;

module.exports = {
	config: {
		name: "update",
		version: "1.0",
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

	onStart: async function ({ message, event, commandName }) {
		try {
			const { data: remotePkg } = await axios.get(`${baseUrl}/package.json`, { timeout: 15000 });
			const { data: versions } = await axios.get(`${baseUrl}/versions.json`, { timeout: 15000 });
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
				"\n\nReact to this message to confirm update.";

			message.reply(msg, (err, info) => {
				if (err) return;
				global.GoatBot.onReaction.set(info.messageID, {
					commandName,
					messageID: info.messageID,
					threadID: info.threadID,
					authorID: event.senderID
				});
			});
		} catch (err) {
			message.reply(`❌ Error checking updates: ${err.message}`);
		}
	},

	onReaction: async function ({ message, event, Reaction, commandName }) {
		if (event.senderID !== Reaction.authorID) return;

		await message.reply("🚀 Updating...");

		try {
			const { data: versions } = await axios.get(`${baseUrl}/versions.json`, { timeout: 15000 });
			fs.writeFileSync(path.resolve(__dirname, "../../versions.json"), JSON.stringify(versions, null, 2));

			execSync("node update.js", { cwd: path.resolve(__dirname, "../.."), stdio: "inherit" });
			const msg = await message.reply("✅ Update complete. Reply 'yes' or 'y' to restart the bot.");
			global.GoatBot.onReply.set(msg.messageID, {
				commandName,
				messageID: msg.messageID,
				threadID: event.threadID,
				authorID: event.senderID
			});
		} catch (err) {
			message.reply(`❌ Update failed: ${err.message}`);
		}
	},

	onReply: async function ({ message, event, Reply }) {
		if (event.senderID !== Reply.authorID) return;
		const answer = (event.body || "").trim().toLowerCase();
		if (answer !== "yes" && answer !== "y") return;

		const fs = require("fs");
		const path = require("path");
		const CACHE_DIR = path.resolve(process.cwd(), "cache");
		const RESTART_FILE = path.join(CACHE_DIR, "restart.txt");

		if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
		const data = { time: Date.now(), threads: [event.threadID], sender: event.senderID };
		fs.writeFileSync(RESTART_FILE, JSON.stringify(data), "utf8");

		await message.reply("🔄 Restarting…");
		setTimeout(() => process.exit(2), 2000);
	}
};

function compareVersion(v1, v2) {
	const a = v1.split(".").map(Number);
	const b = v2.split(".").map(Number);
	for (let i = 0; i < 3; i++) {
		if ((a[i] || 0) > (b[i] || 0)) return 1;
		if ((a[i] || 0) < (b[i] || 0)) return -1;
	}
	return 0;
}
