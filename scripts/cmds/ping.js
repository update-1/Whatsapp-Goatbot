"use strict";

module.exports = {
	config: {
		name: "ping",
		aliases: ["p"],
		version: "1.0.0",
		author: "Rômeo",
		countDown: 5,
		role: 0,
		shortDescription: "Check bot latency",
		longDescription: "Displays the bot's response time and uptime.",
		category: "system",
		guide: {
			en: "{pn}"
		}
	},

	onStart: async ({ message }) => {
		const start = Date.now();

		const sent = await message.reply("🏓 Pinging...");

		const latency = Date.now() - start;
		const uptime = process.uptime();

		const days = Math.floor(uptime / 86400);
		const hours = Math.floor((uptime % 86400) / 3600);
		const mins = Math.floor((uptime % 3600) / 60);
		const secs = Math.floor(uptime % 60);

		return message.edit(
			sent.messageID,
			`🏓 *Pong!*\n\n` +
			`⚡ Latency: ${latency} ms\n` +
			`⏱️ Uptime: ${days}d ${hours}h ${mins}m ${secs}s`
		);
	}
};