#!/usr/bin/env node
"use strict";

const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

const repoOwner = "update-1";
const repoName = "Whatsapp-Goatbot";
const repoBranch = "main";
const baseUrl = "https://raw.githubusercontent.com/" + repoOwner + "/" + repoName + "/" + repoBranch;

async function main() {
	try {
		// 1. Save latest versions.json locally
		var versionsRes = await axios.get(baseUrl + "/versions.json", { timeout: 15000 });
		fs.writeFileSync(path.join(__dirname, "versions.json"), JSON.stringify(versionsRes.data, null, 2));
		console.log("[update] Saved versions.json");

		// 2. Fetch and run the remote updater
		var updaterRes = await axios.get(baseUrl + "/updater.js", { timeout: 30000, responseType: "text" });
		var updaterPath = path.join(__dirname, "updater.js");
		await fs.writeFile(updaterPath, updaterRes.data, "utf8");

		delete require.cache[updaterPath];
		var updater = require(updaterPath);

		if (typeof updater === "function") {
			await updater();
		} else {
			throw new Error("Remote updater did not export a function.");
		}
	} catch (error) {
		console.error("[update] Error:", error.message);
		process.exit(1);
	}
}

main().catch(function(err) {
	console.error("[update] Error:", err.message);
	process.exit(1);
});
