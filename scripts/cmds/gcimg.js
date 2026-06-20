"use strict";

const fs = require("fs");
const { createCanvas, loadImage } = require("canvas");
const axios = require("axios");

const PROFILE_SIZE = 42;

async function fetchAvatar(api, jid) {
    try {
        const url = await global.ST.DB.userData.getAvatarUrl(api, jid);
        const res = await axios.get(url, { responseType: "arraybuffer", timeout: 8000 });
        return Buffer.from(res.data);
    } catch { return null; }
}

module.exports = {
    config: {
        name: "gcimg",
        version: "2.0",
        author: "Rômeo",
        countDown: 15,
        role: 0,
        shortDescription: "Group stats image",
        longDescription: "Generates a group image showing all member profile pictures.",
        category: "group",
        guide: { en: "{pn} [--colour <c>] [--admincolour <c>] [--membercolour <c>] [--bgcolour <url>]" },
    },

    onStart: async function ({ api, event, message, threadsData }) {
        await message.react("⏳");

        try {
            // ── Parse options ──────────────────────────────────────────────────────
            const args = (event.body || "").split(/\s+/).slice(1);
            const opt = { colour: "red", admincolour: "blue", membercolour: "green", bgcolour: null };
            args.forEach((a, i) => {
                if (a === "--colour" && args[i + 1]) opt.colour = args[i + 1];
                if (a === "--admincolour" && args[i + 1]) opt.admincolour = args[i + 1];
                if (a === "--membercolour" && args[i + 1]) opt.membercolour = args[i + 1];
                if (a === "--bgcolour" && args[i + 1]) opt.bgcolour = args[i + 1];
            });

            // ── Group data ─────────────────────────────────────────────────────────
            const thread = await threadsData(event.threadID);
            if (!thread) return message.reply("❌ Could not load group info.");

            const adminIDs = thread.adminIDs || [];
            const allMembers = (thread.allMembers || []).filter(m => m.inGroup !== false);
            const adminMembers = allMembers.filter(m => adminIDs.some(a => a === m.uid || a.split("@")[0] === m.uid.split("@")[0]));
            const normMembers = allMembers.filter(m => !adminIDs.some(a => a === m.uid || a.split("@")[0] === m.uid.split("@")[0]));
            const orderedMembers = [...adminMembers, ...normMembers];

            // ── Fetch avatars in parallel ──────────────────────────────────────────
            const buffers = await Promise.all(orderedMembers.map(m => fetchAvatar(api, m.uid)));

            // ── Layout maths ──────────────────────────────────────────────────────
            const GAP = 10;
            const MAX_PER_ROW = 15;
            const HEADER_H = PROFILE_SIZE * 3 + 170;     // group pic + name + counts
            const numRows = Math.ceil(orderedMembers.length / MAX_PER_ROW);
            const canvasWidth = MAX_PER_ROW * (PROFILE_SIZE + GAP) - GAP + 20;
            const canvasHeight = HEADER_H + numRows * (PROFILE_SIZE + GAP) + 20;

            const canvas = createCanvas(canvasWidth, canvasHeight);
            const ctx = canvas.getContext("2d");

            // ── Background ─────────────────────────────────────────────────────────
            if (opt.bgcolour) {
                try {
                    const res = await axios.get(opt.bgcolour, { responseType: "arraybuffer", timeout: 8000 });
                    const bg = await loadImage(Buffer.from(res.data));
                    ctx.drawImage(bg, 0, 0, canvasWidth, canvasHeight);
                } catch { /* fall through to solid bg */ }
            }
            if (!opt.bgcolour) {
                ctx.fillStyle = "#1a1a2e";
                ctx.fillRect(0, 0, canvasWidth, canvasHeight);
            }

            // ── Group profile picture ───────────────────────────────────────────────
            const GRP_SIZE = PROFILE_SIZE * 3;
            const GRP_X = (canvasWidth - GRP_SIZE) / 2;
            const GRP_Y = 20;
            const GRP_CX = canvasWidth / 2;
            const GRP_CY = GRP_Y + GRP_SIZE / 2;

            const groupBuf = await fetchAvatar(api, event.threadID);
            if (groupBuf) {
                const img = await loadImage(groupBuf).catch(() => null);
                if (img) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(GRP_CX, GRP_CY, GRP_SIZE / 2, 0, Math.PI * 2);
                    ctx.closePath();
                    ctx.clip();
                    ctx.drawImage(img, GRP_X, GRP_Y, GRP_SIZE, GRP_SIZE);
                    ctx.restore();
                    // border ring
                    ctx.beginPath();
                    ctx.arc(GRP_CX, GRP_CY, GRP_SIZE / 2 + 3, 0, Math.PI * 2);
                    ctx.lineWidth = 4;
                    ctx.strokeStyle = opt.colour;
                    ctx.stroke();
                }
            }

            // ── Group name ─────────────────────────────────────────────────────────
            const nameY = GRP_Y + GRP_SIZE + 38;
            ctx.font = "bold 22px Arial";
            ctx.fillStyle = opt.colour;
            ctx.textAlign = "center";
            ctx.fillText(thread.name || "Group", GRP_CX, nameY);

            // ── Admin / member counts ───────────────────────────────────────────────
            const countY = nameY + 34;
            ctx.font = "14px Arial";

            ctx.textAlign = "left";
            ctx.fillStyle = opt.admincolour;
            ctx.fillText(`👑 Admins: ${adminMembers.length}`, 10, countY);

            ctx.textAlign = "right";
            ctx.fillStyle = opt.membercolour;
            ctx.fillText(`👥 Members: ${normMembers.length}`, canvasWidth - 10, countY);

            // ── Member profile pictures ─────────────────────────────────────────────
            let px = 10, py = countY + 20, colIdx = 0;

            for (let i = 0; i < orderedMembers.length; i++) {
                const buf = buffers[i];
                const isAdmin = adminMembers.some(m => m.uid === orderedMembers[i].uid);
                const cx = px + PROFILE_SIZE / 2;
                const cy = py + PROFILE_SIZE / 2;
                const r = PROFILE_SIZE / 2;

                if (buf) {
                    const img = await loadImage(buf).catch(() => null);
                    if (img) {
                        ctx.save();
                        ctx.beginPath();
                        ctx.arc(cx, cy, r, 0, Math.PI * 2);
                        ctx.closePath();
                        ctx.clip();
                        ctx.drawImage(img, px, py, PROFILE_SIZE, PROFILE_SIZE);
                        ctx.restore();
                    }
                } else {
                    // grey placeholder circle
                    ctx.beginPath();
                    ctx.arc(cx, cy, r, 0, Math.PI * 2);
                    ctx.fillStyle = "#2d2d4e";
                    ctx.fill();
                }

                // coloured border
                ctx.beginPath();
                ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
                ctx.lineWidth = 2.5;
                ctx.strokeStyle = isAdmin ? opt.admincolour : opt.membercolour;
                ctx.stroke();

                colIdx++;
                px += PROFILE_SIZE + GAP;
                if (colIdx >= MAX_PER_ROW) {
                    colIdx = 0;
                    px = 10;
                    py += PROFILE_SIZE + GAP;
                }
            }

            // ── Render & send as image ─────────────────────────────────────────────
            const imgBuffer = canvas.toBuffer("image/png");
            const caption =
                `📊 *${thread.name || "Group"}*\n` +
                `👑 Admins: ${adminMembers.length} | 👥 Members: ${normMembers.length}`;

            await message.react("✅");
            await api.sendImage(imgBuffer, event.threadID, caption, { mimetype: "image/png" });

        } catch (err) {
            await message.react("❌");
            return message.reply("❌ Error: " + err.message);
        }
    },
};
