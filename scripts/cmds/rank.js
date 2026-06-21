"use strict";

const Canvas = require('canvas');
const axios = require('axios');

const normUID = (jid) => {
  if (!jid) return "";
  if (Array.isArray(jid)) jid = jid[0];
  if (typeof jid !== "string") return "";
  return jid.split(":")[0].split("@")[0];
};

// ── GoatBot-V2 EXP system ─────────────────────────────────────────────────────
// Same formulas as GoatBot-V2/scripts/cmds/rank.js
const DELTA_NEXT = 5; // exp gap per level (configurable)
const expToLevel = (exp) => Math.floor((1 + Math.sqrt(1 + 8 * exp / DELTA_NEXT)) / 2);
const levelToExp = (level) => Math.floor(((level * level - level) * DELTA_NEXT) / 2);

function roundRect(ctx, x, y, width, height, radius) {
  if (typeof radius === 'number') {
    radius = { tl: radius, tr: radius, br: radius, bl: radius };
  } else {
    var defaultRadius = { tl: 0, tr: 0, br: 0, bl: 0 };
    for (var side in defaultRadius) {
      radius[side] = radius[side] || defaultRadius[side];
    }
  }
  ctx.beginPath();
  ctx.moveTo(x + radius.tl, y);
  ctx.lineTo(x + width - radius.tr, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
  ctx.lineTo(x + width, y + height - radius.br);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
  ctx.lineTo(x + radius.bl, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
  ctx.lineTo(x, y + radius.tl);
  ctx.quadraticCurveTo(x, y, x + radius.tl, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

module.exports = {
  config: {
    name: 'rank',
    version: "4.0.0",
    author: "Rômeo",
    role: 0,
    shortDescription: 'Display user rank and EXP',
    longDescription: 'View your level, EXP, and rank in the group. EXP is earned by chatting.',
    category: 'utility',
    guide: { en: '{pn} [@user] | top [number]' }
  },

  // ── onChat: award +1 EXP per message (same as GoatBot-V2) ─────────────────
  onChat: async ({ event, userData }) => {
    if (!event.senderID) return;
    try {
      const u = await userData(event.senderID);
      const currentExp = typeof u.exp === 'number' && !isNaN(u.exp) ? u.exp : 0;
      await global.GoatBot.DB.users.set(event.senderID, currentExp + 1, "exp");
    } catch (_) { }
  },

  // ── onStart: show rank card ───────────────────────────────────────────────
  onStart: async ({ api, event, args, message, threadsData, userData }) => {
    try {
      if (!event.isGroup) {
        return message.reply("❌ This command can only be used in groups.");
      }

      const command = args[0]?.toLowerCase();
      let thread;
      try {
        thread = await threadsData(event.threadID);
      } catch (e) {
        return message.reply("❌ Failed to get group data.");
      }

      const participants = thread?.allMembers || [];
      const activeMembers = participants.filter(m => m.inGroup !== false);

      // Per-thread message count map (like GoatBot-V2)
      const memberMsgCount = thread.memberMsgCount || {};

      const usedNames = new Set();

      // Build user list
      let users = [];
      for (const p of activeMembers) {
        const u = await userData(p.uid);

        const pNorm = normUID(p.uid);
        let displayName = null;
        if (pNorm === normUID(event.senderID)) displayName = event.senderName || event.pushName;

        if (!displayName) {
          try {
            const sock = api.ctx ? api.ctx.sock : null;
            if (sock && sock.contacts) {
              const c = sock.contacts[pNorm + "@s.whatsapp.net"] || sock.contacts[pNorm + "@lid"];
              if (c) displayName = c.notify || c.name || c.verifiedName;
            }
          } catch (_) {}
        }

        if (!displayName || String(displayName).match(/^\d+$/) || displayName === "Unknown") {
          displayName = u ? u.name : null;
        }
        if (!displayName || displayName === "Unknown") displayName = "Unknown";

        let finalName = displayName;
        let c = 1;
        while (usedNames.has(finalName)) finalName = `${displayName}${c++}`;
        usedNames.add(finalName);

        const exp = u ? (typeof u.exp === 'number' ? u.exp : 0) : 0;
        // Use per-thread msgCount for group rank, global exp for level
        const threadCount = memberMsgCount[p.uid] || 0;
        users.push({ jid: p.uid, exp, threadCount, pushName: finalName, pfp: u ? u.pfp : null });
      }

      // Sort by per-thread message count for group leaderboard
      users.sort((a, b) => b.threadCount - a.threadCount);


      // ── Top leaderboard ───────────────────────────────────────────────────
      if (command === 'top' || command === 'leaderboard') {
        await message.react("⏳");
        const topCount = Math.min(parseInt(args[1]) || 10, 20);
        const topUsers = users.slice(0, topCount);
        const groupName = thread?.name || "the group";
        await generateTopCard(api, event, message, topUsers, groupName, topCount);
        return;
      }

      // ── Individual rank card ──────────────────────────────────────────────
      await message.react("⏳").catch(() => { });

      let targetJid;
      if (event.mentions) {
        if (Array.isArray(event.mentions) && event.mentions.length > 0) {
          targetJid = event.mentions[0];
        } else if (Object.keys(event.mentions).length > 0) {
          targetJid = Object.keys(event.mentions)[0];
        } else {
          targetJid = event.senderID;
        }
      } else {
        targetJid = event.senderID;
      }

      const targetNorm = normUID(targetJid);
      const rankIndex = users.findIndex(u => normUID(u.jid) === targetNorm);
      const targetData = await userData(targetJid);
      const targetPfp = targetData ? targetData.pfp : null;
      const userRank = rankIndex !== -1 ? rankIndex + 1 : "N/A";
      const userEntry = rankIndex !== -1 ? users[rankIndex] : { exp: 0, pushName: "Unknown", jid: targetJid };

      const exp = userEntry.exp;
      const level = expToLevel(exp);
      const expThisLevel = exp - levelToExp(level);
      const expNeeded = levelToExp(level + 1) - levelToExp(level);

      await generateRankCard(api, event, message, targetJid, userRank, users.length, level, expThisLevel, expNeeded, exp, userEntry.pushName, targetPfp);

    } catch (error) {
      console.error('Rank command error:', error);
      await message.react("❌").catch(() => { });
      await message.reply('❌ Error generating rank card: ' + error.message).catch(() => { });
    }
  }
};

// ── Rank card generator ───────────────────────────────────────────────────────
async function generateRankCard(api, event, message, targetJid, userRank, totalUsers, level, expThisLevel, expNeeded, totalExp, targetName, targetPfp) {
  try {
    let avatarImg;
    try {
      const targetUrl = await global.GoatBot.DB.userData.getAvatarUrl(api, targetJid);
      const res = await axios.get(targetUrl, { responseType: 'arraybuffer', timeout: 5000 });
      avatarImg = await Canvas.loadImage(res.data);
    } catch (_) {
      const tmpCanvas = Canvas.createCanvas(220, 220);
      const tmpCtx = tmpCanvas.getContext('2d');
      tmpCtx.fillStyle = '#444444';
      tmpCtx.fillRect(0, 0, 220, 220);
      avatarImg = await Canvas.loadImage(tmpCanvas.toBuffer());
    }

    const width = 1600, height = 500;
    const canvas = Canvas.createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Background
    const bgGradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height));
    bgGradient.addColorStop(0, '#1a0066');
    bgGradient.addColorStop(0.3, '#0d0033');
    bgGradient.addColorStop(0.6, '#001a33');
    bgGradient.addColorStop(1, '#000a1a');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    // Stars
    ctx.fillStyle = '#ffffff08';
    for (let i = 0; i < 80; i++) {
      const x = (i * 37) % width;
      const y = Math.sin(i * 0.3) * 40 + height / 2;
      const size = Math.sin(i * 0.5) * 2 + 2;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    // Glass card
    const cardGradient = ctx.createLinearGradient(0, 0, 0, height);
    cardGradient.addColorStop(0, '#ffffff20');
    cardGradient.addColorStop(0.5, '#ffffff15');
    cardGradient.addColorStop(1, '#ffffff10');
    ctx.fillStyle = cardGradient;
    ctx.strokeStyle = '#ffffff35';
    ctx.lineWidth = 3;
    roundRect(ctx, 25, 25, width - 50, height - 50, 40);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#00ffaa25';
    ctx.lineWidth = 1;
    roundRect(ctx, 27, 27, width - 54, height - 54, 38);
    ctx.stroke();

    // Avatar glow
    const avatarSize = 220, avatarX = 70, avatarY = (height / 2) - (avatarSize / 2);
    for (let i = 0; i < 3; i++) {
      ctx.shadowColor = '#00FFAA';
      ctx.shadowBlur = 40 - (i * 10);
      ctx.beginPath();
      ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 15 - (i * 5), 0, Math.PI * 2);
      ctx.fillStyle = `#00FFAA${(20 - i * 5).toString(16)}`;
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    const avatarBorderGrad = ctx.createLinearGradient(avatarX, avatarY, avatarX + avatarSize, avatarY + avatarSize);
    avatarBorderGrad.addColorStop(0, '#00FFAA');
    avatarBorderGrad.addColorStop(0.5, '#00DDFF');
    avatarBorderGrad.addColorStop(1, '#0088FF');
    ctx.strokeStyle = avatarBorderGrad;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 8, 0, Math.PI * 2);
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize);
    ctx.restore();

    const levelGrad = ctx.createLinearGradient(width - 300, 80, width - 100, 120);
    levelGrad.addColorStop(0, '#00FFAA');
    levelGrad.addColorStop(0.5, '#00DDFF');
    levelGrad.addColorStop(1, '#0088FF');

    // Name
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 8;
    ctx.font = 'bold 62px "Arial Black", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    let displayName = targetName.length > 20 ? targetName.substring(0, 17) + '...' : targetName;
    ctx.fillText(displayName, width / 2, 120);
    ctx.shadowBlur = 0;

    // Total EXP label (top-left area)
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#aaaaaa';
    ctx.fillText(`Total EXP: ${totalExp.toLocaleString()}`, avatarX + avatarSize + 50, 120);

    // Level
    ctx.font = 'bold 58px "Arial Black", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = levelGrad;
    ctx.shadowColor = '#00FFAA';
    ctx.shadowBlur = 15;
    ctx.fillText(`Level ${level}`, width - 120, 120);
    ctx.shadowBlur = 0;

    // Rank
    ctx.font = 'bold 55px sans-serif';
    ctx.fillStyle = levelGrad;
    ctx.textAlign = 'center';
    ctx.shadowColor = '#00FFAA';
    ctx.shadowBlur = 10;
    ctx.fillText(`#${userRank}/${totalUsers}`, width - 180, height - 100);
    ctx.shadowBlur = 0;

    // Divider line
    const lineY = height / 2 + 10;
    const lineGrad = ctx.createLinearGradient(avatarX + avatarSize + 50, lineY, width - 200, lineY);
    lineGrad.addColorStop(0, '#00FFAA00');
    lineGrad.addColorStop(0.1, '#00FFAA60');
    lineGrad.addColorStop(0.5, '#00FFAAFF');
    lineGrad.addColorStop(0.9, '#0080FF60');
    lineGrad.addColorStop(1, '#0080FF00');
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(avatarX + avatarSize + 50, lineY);
    ctx.lineTo(width - 200, lineY);
    ctx.stroke();

    // EXP bar
    const barWidth = 900, barHeight = 40;
    const barX = (width / 2) - (barWidth / 2);
    const barY = height - 130;
    const progress = expNeeded > 0 ? Math.min(expThisLevel / expNeeded, 1) : 1;

    ctx.font = 'bold 40px sans-serif';
    ctx.fillStyle = '#E8E8E8';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 4;
    ctx.fillText(`EXP: ${expThisLevel.toLocaleString()} / ${expNeeded.toLocaleString()}`, width / 2, barY - 15);
    ctx.shadowBlur = 0;

    // Bar background
    ctx.fillStyle = '#1a1a1a';
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#333333';
    roundRect(ctx, barX, barY, barWidth, barHeight, 22);
    ctx.fill();
    ctx.stroke();

    // Bar fill
    if (progress > 0) {
      const xpGrad = ctx.createLinearGradient(barX, barY, barX + barWidth, barY);
      xpGrad.addColorStop(0, '#00FFAA');
      xpGrad.addColorStop(0.3, '#00DDFF');
      xpGrad.addColorStop(0.7, '#0088FF');
      xpGrad.addColorStop(1, '#0066CC');
      ctx.fillStyle = xpGrad;
      ctx.strokeStyle = 'transparent';
      ctx.shadowColor = '#00FFAA';
      ctx.shadowBlur = 20;
      roundRect(ctx, barX, barY, Math.max(barWidth * progress, 44), barHeight, 22);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Shine
      const shineGrad = ctx.createLinearGradient(barX, barY, barX, barY + barHeight);
      shineGrad.addColorStop(0, '#ffffff50');
      shineGrad.addColorStop(0.3, '#ffffff30');
      shineGrad.addColorStop(1, '#ffffff00');
      ctx.fillStyle = shineGrad;
      ctx.strokeStyle = 'transparent';
      roundRect(ctx, barX, barY, Math.max(barWidth * progress, 44), barHeight / 2, 22);
      ctx.fill();
    }

    const buffer = canvas.toBuffer("image/png");
    const progressPct = (progress * 100).toFixed(1);

    await message.react("✅").catch(() => { });
    await api.sendImage(
      buffer,
      event.threadID,
      `🏆 *RANK CARD* 🏆\n👤 *${displayName}*\n⭐ *Level ${level}* | 🏅 *Rank #${userRank}/${totalUsers}*\n🔥 *${totalExp.toLocaleString()} Total EXP* | 🎯 *${progressPct}% to next level*`,
      { mimetype: "image/png" }
    );
  } catch (error) {
    console.error('Error generating rank card:', error);
    throw error;
  }
}

// ── Top leaderboard card ──────────────────────────────────────────────────────
async function generateTopCard(api, event, message, topUsers, groupName, topCount) {
  try {
    const width = 1500;
    const height = Math.max(700, 180 + (topUsers.length * 90));
    const canvas = Canvas.createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const bgGradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height));
    bgGradient.addColorStop(0, '#2a0860');
    bgGradient.addColorStop(0.5, '#1a0340');
    bgGradient.addColorStop(1, '#0d0120');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#ffffff10';
    for (let i = 0; i < 50; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const size = Math.random() * 4 + 1;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.font = 'bold 56px "Arial Black", sans-serif';
    ctx.fillStyle = '#FFD700';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#FF8800';
    ctx.shadowBlur = 15;
    ctx.fillText(`🏆 TOP ${topCount} LEADERBOARD`, width / 2, 100);
    ctx.shadowBlur = 0;

    ctx.font = 'bold 36px sans-serif';
    ctx.fillStyle = '#DDDDDD';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 5;
    let displayGroupName = groupName.length > 30 ? groupName.substring(0, 27) + '...' : groupName;
    ctx.fillText(displayGroupName, width / 2, 150);
    ctx.shadowBlur = 0;

    const cardX = 30, cardY = 30, cardWidth = width - 60, cardHeight = height - 60;
    const cardGrad = ctx.createLinearGradient(0, 0, 0, cardHeight);
    cardGrad.addColorStop(0, '#ffffff25');
    cardGrad.addColorStop(1, '#ffffff15');
    ctx.fillStyle = cardGrad;
    ctx.strokeStyle = '#ffffff40';
    ctx.lineWidth = 4;
    roundRect(ctx, cardX, cardY, cardWidth, cardHeight, 35);
    ctx.fill();
    ctx.stroke();

    const avatarSize = 70, spacingY = 90;
    const paddingLeft = cardX + 120, paddingTop = cardY + 130;

    const avatars = await Promise.all(topUsers.map(async (u) => {
      try {
        const url = await global.GoatBot.DB.userData.getAvatarUrl(api, u.jid);
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
        return await Canvas.loadImage(res.data);
      } catch (_) {
        const tmpCanvas = Canvas.createCanvas(70, 70);
        const tmpCtx = tmpCanvas.getContext('2d');
        tmpCtx.fillStyle = '#444444';
        tmpCtx.fillRect(0, 0, 70, 70);
        return await Canvas.loadImage(tmpCanvas.toBuffer());
      }
    }));

    for (let i = 0; i < topUsers.length; i++) {
      const user = topUsers[i];
      const yPos = paddingTop + i * spacingY;
      const xPos = paddingLeft;

      if (avatars[i]) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(xPos + avatarSize / 2, yPos + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatars[i], xPos, yPos, avatarSize, avatarSize);
        ctx.restore();
      }

      let displayName = user.pushName;
      if (displayName.length > 20) displayName = displayName.substring(0, 17) + '...';

      ctx.font = 'bold 32px "Arial Black", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 6;
      ctx.fillText(displayName, xPos + avatarSize + 30, yPos + avatarSize / 2 + 12);
      ctx.shadowBlur = 0;

      ctx.font = 'bold 40px sans-serif';
      ctx.fillStyle = i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : '#AAAAAA';
      ctx.textAlign = 'right';
      ctx.fillText(`${i + 1}`, xPos - 30, yPos + avatarSize / 2 + 15);

      // Use GoatBot-V2 EXP formula for level, per-thread count for ranking
      const level = expToLevel(user.exp);
      ctx.font = '28px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillStyle = '#00FFAA';
      ctx.fillText(`Level: ${level}`, cardX + cardWidth - 120, yPos + avatarSize / 2 - 8);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(`Msgs (here): ${user.threadCount.toLocaleString()}`, cardX + cardWidth - 120, yPos + avatarSize / 2 + 28);
    }

    const buffer = canvas.toBuffer("image/png");
    await message.react("✅");
    await api.sendImage(
      buffer,
      event.threadID,
      `🏆 Top ${topCount} users in *${displayGroupName}*`,
      { mimetype: "image/png" }
    );
  } catch (error) {
    console.error('Error generating top rank card:', error);
    throw error;
  }
}
