const fs = require("fs-extra");
const readline = require("readline");

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

async function restoreDir(backupPath, restorePath) {
	const items = fs.readdirSync(backupPath);
	for (const item of items) {
		const src = `${backupPath}/${item}`;
		const dest = `${restorePath}/${item}`;
		if (fs.lstatSync(src).isDirectory()) {
			fs.ensureDirSync(dest);
			await restoreDir(src, dest);
		} else {
			fs.copyFileSync(src, dest);
		}
	}
}

(async () => {
	let version = process.argv[2];
	if (!version) {
		version = await new Promise(resolve => {
			rl.question("Enter backup version to restore: ", resolve);
		});
	}
	if (!version) {
		console.error("No version specified.");
		process.exit(1);
	}

	version = version.replace("backup_", "");
	const backupDir = `${process.cwd()}/backups/backup_${version}`;

	if (!fs.existsSync(backupDir)) {
		console.error(`Backup folder not found: ${backupDir}`);
		process.exit(1);
	}

	const files = fs.readdirSync(backupDir);
	for (const file of files) {
		const src = `${backupDir}/${file}`;
		const dest = `${process.cwd()}/${file}`;
		if (fs.lstatSync(src).isDirectory()) {
			fs.ensureDirSync(dest);
			await restoreDir(src, dest);
		} else {
			fs.copyFileSync(src, dest);
		}
	}

	const pkg = require(`${process.cwd()}/package.json`);
	pkg.version = version;
	fs.writeFileSync(`${process.cwd()}/package.json`, JSON.stringify(pkg, null, 2));

	console.log(`Restored backup_${version} successfully.`);
	process.exit(0);
})();
