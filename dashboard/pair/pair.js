const express = require('express');
const fs = require('fs');
const { upload } = require('./mega.js');
const pino = require('pino');
const { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion, generateWAMessageFromContent, proto } = require('@innovatorssoft/baileys');
const pn = require('awesome-phonenumber');
const zlib = require('zlib');

const router = express.Router();

// Ensure the session directory exists
function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true, maxRetries: 10, retryDelay: 1000 });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    let dirs = './' + (num || `session`);

    // Remove existing session if present
    await removeFile(dirs);

    // Clean the phone number - remove any non-digit characters
    num = num.replace(/[^0-9]/g, '');

    // Validate the phone number using awesome-phonenumber
    const phone = pn.parse('+' + num);
    if (!phone.valid) {
        if (!res.headersSent) {
            return res.status(400).send({ code: 'Invalid phone number. Please enter your full international number (e.g., 15551234567 for US, 447911123456 for UK, 84987654321 for Vietnam, etc.) without + or spaces.' });
        }
        return;
    }
    // Use the international number format (E.164, without '+')
    num = phone.number.e164.replace('+', '');

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version, isLatest } = await fetchLatestBaileysVersion();
            let RomeoBot = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.windows('Chrome'),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            });

            RomeoBot.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, isNewLogin, isOnline } = update;

                if (connection === 'open') {
                    console.log("✅ Connected successfully!");
                    console.log("📱 Sending session file to user...");

                    try {
                        const sessionRomeo = fs.readFileSync(dirs + '/creds.json');

                        // Send session file to user
                        const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                        await RomeoBot.sendMessage(userJid, {
                            document: sessionRomeo,
                            mimetype: 'application/json',
                            fileName: 'creds.json'
                        });
                        console.log("📄 Session file sent successfully");

                        try {
                            let sessionId;
                            try {
                                const credsContent = fs.readFileSync(dirs + '/creds.json');
                                const formData = new FormData();
                                formData.append('files[]', new Blob([credsContent], { type: 'application/json' }), 'creds.json');
                                const response = await fetch('https://uguu.se/upload.php', {
                                    method: 'POST',
                                    body: formData
                                });
                                const data = await response.json();
                                if (data && data.success && data.files && data.files[0] && data.files[0].url) {
                                    const fileUrl = data.files[0].url;
                                    const base64Session = Buffer.from(fileUrl).toString('base64');
                                    sessionId = "RomeoBot~" + base64Session;
                                } else {
                                    throw new Error("Failed to get file URL from upload response");
                                }
                            } catch (uploadError) {
                                console.error("Upload failed, falling back to gzip session ID:", uploadError);
                                const credsContent = fs.readFileSync(dirs + '/creds.json');
                                const base64Session = zlib.gzipSync(credsContent).toString('base64');
                                sessionId = "RomeoBot!" + base64Session;
                            }

                            // 1. Send the Session ID as standard text to guarantee delivery (Interactive Messages often fail on WhatsApp Web)
                            await RomeoBot.sendMessage(userJid, {
                                text: `*Romeo Bot Session ID:*\n\n${sessionId}\n\n⚠️ Please do not share this session ID with anyone!`
                            });

                            // 2. Send Interactive Copy Button Message (using nativeFlow interactiveButtons)
                            if (sessionId.startsWith("RomeoBot~")) {
                                await RomeoBot.sendMessage(userJid, {
                                    text: "Tap the button below to easily copy your session ID.",
                                    footer: "Romeo Bot",
                                    viewOnce: true,
                                    interactiveButtons: [
                                        {
                                            name: "cta_copy",
                                            buttonParamsJson: JSON.stringify({
                                                display_text: "📋 COPY SESSION ID",
                                                copy_code: sessionId
                                            })
                                        }
                                    ],
                                    contextInfo: {
                                        deviceListMetadata: {},
                                        deviceListMetadataVersion: 2
                                    }
                                });
                                console.log("📄 Session ID copy button sent successfully");
                            }
                        } catch (err) {
                            console.error("Error generating Session ID:", err);
                        }





                        // Clean up session after use
                        console.log("🧹 Cleaning up session...");
                        await delay(1000);
                        removeFile(dirs);
                        console.log("✅ Session cleaned up successfully");
                        console.log("🎉 Process completed successfully!");
                        // Do not exit the process, just finish gracefully
                    } catch (error) {
                        console.error("❌ Error sending messages:", error);
                        // Still clean up session even if sending fails
                        removeFile(dirs);
                        // Do not exit the process, just finish gracefully
                    }
                }

                if (isNewLogin) {
                    console.log("🔐 New login via pair code");
                }

                if (isOnline) {
                    console.log("📶 Client is online");
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;

                    if (statusCode === 401) {
                        console.log("❌ Logged out from WhatsApp. Need to generate new pair code.");
                    } else {
                        console.log("🔁 Connection closed — restarting...");
                        initiateSession();
                    }
                }
            });

            if (!RomeoBot.authState.creds.registered) {
                await delay(3000); // Wait 3 seconds before requesting pairing code
                num = num.replace(/[^\d+]/g, '');
                if (num.startsWith('+')) num = num.substring(1);

                try {
                    let code = await RomeoBot.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    if (!res.headersSent) {
                        console.log({ num, code });
                        await res.send({ code });
                    }
                } catch (error) {
                    console.error('Error requesting pairing code:', error);
                    if (!res.headersSent) {
                        res.status(503).send({ code: 'Failed to get pairing code. Please check your phone number and try again.' });
                    }
                }
            }

            RomeoBot.ev.on('creds.update', saveCreds);
        } catch (err) {
            console.error('Error initializing session:', err);
            if (!res.headersSent) {
                res.status(503).send({ code: 'Service Unavailable' });
            }
        }
    }

    await initiateSession();
});

// Global uncaught exception handler
process.on('uncaughtException', (err) => {
    let e = String(err);
    if (e.includes("conflict")) return;
    if (e.includes("not-authorized")) return;
    if (e.includes("Socket connection timeout")) return;
    if (e.includes("rate-overlimit")) return;
    if (e.includes("Connection Closed")) return;
    if (e.includes("Timed Out")) return;
    if (e.includes("Value not found")) return;
    if (e.includes("Stream Errored")) return;
    if (e.includes("Stream Errored (restart required)")) return;
    if (e.includes("statusCode: 515")) return;
    if (e.includes("statusCode: 503")) return;
    console.log('Caught exception: ', err);
});

module.exports = router;