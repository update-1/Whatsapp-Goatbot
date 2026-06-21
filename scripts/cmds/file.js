const fs = require("fs");
const path = require("path");

module.exports = {
	config: {
		name: "file",
		aliases: [],
		version: "1.0.0",
		author: "Rômeo",
		countDown: 5,
		role: 0,
		shortDescription: "Get raw code of a command",
		longDescription: "Sends the raw source code of any command file.",
		category: "system",
		guide: {
			en: "{pn} <cmdName>"
		}
	},

	onStart: async ({ api, event, args, message }) => {
		const cmdName = args[0];
		if (!cmdName) return message.reply("Usage: !file <commandName>");

		const filePath = path.resolve(__dirname, `${cmdName}.js`);
		if (!fs.existsSync(filePath)) return message.reply(`Command "${cmdName}.js" not found.`);

		const code = fs.readFileSync(filePath, "utf8");
		api.sendMessage(code, event.threadID, event.messageID);
	}
};
