"use strict";

/**
 * count.js — Per-thread message count (like GoatBot-V2)
 *
 * Reads from threadsData.memberMsgCount[uid] — a flat map that
 * handletCheckData.js increments per message via incrementMsgCount().
 * Each thread has its own independent count, just like GoatBot-V2.
 *
 * Usage:
 *   .count          — your count in this group
 *   .count @user    — tagged user's count
 *   .count all      — ranked list of all members
 *   .count top [N]  — top N members (default 10)
 */

module.exports = {
  config: {
    name: 'count',
    aliases: ['msgcount', 'messagecount'],
    version: "2.0.0",
    author: 'Rômeo',
    role: 0,
    shortDescription: 'Show per-group message count',
    longDescription: 'Show message count for yourself or all group members. Count is per-group (different groups, different counts).',
    category: 'utility',
    guide: { en: '{pn} [@user | all | top [N]]' }
  },

  onStart: async ({ api, event, args, userData, threadsData, message }) => {
    if (!event.isGroup) {
      return message.reply("❌ This command can only be used in groups.");
    }

    const normUID = (jid) => {
      if (!jid) return "";
      if (Array.isArray(jid)) jid = jid[0];
      if (typeof jid !== "string") return "";
      return jid.split(":")[0].split("@")[0];
    };

    const thread = await threadsData(event.threadID);

    // memberMsgCount is the per-thread flat map: { uid: count }
    const memberMsgCount = thread.memberMsgCount || {};
    const allMembers = (thread.allMembers || []).filter(m => m.inGroup !== false);

    // Build sorted list: [ { uid, count, name } ]
    const getDisplayName = async (uid) => {
      // 1. Baileys contacts
      try {
        const sock = api.ctx ? api.ctx.sock : null;
        if (sock && sock.contacts) {
          const num = normUID(uid);
          const c = sock.contacts[num + "@s.whatsapp.net"] || sock.contacts[num + "@lid"];
          if (c) {
            const n = c.notify || c.name || c.verifiedName;
            if (n) return n;
          }
        }
      } catch (_) { }
      // 2. DB fallback
      try {
        const u = await userData(uid);
        if (u && u.name && u.name !== "Unknown") return u.name;
      } catch (_) { }
      // 3. Plain number
      return "+" + uid.split("@")[0].split(":")[0];
    };

    // Build member list with per-thread counts
    let members = [];
    for (const m of allMembers) {
      const count = memberMsgCount[m.uid] || 0;
      members.push({ uid: m.uid, count });
    }

    // Also include any UIDs in memberMsgCount that aren't in allMembers
    for (const [uid, count] of Object.entries(memberMsgCount)) {
      const num = normUID(uid);
      if (!members.find(m => normUID(m.uid) === num)) {
        members.push({ uid, count });
      }
    }

    members.sort((a, b) => b.count - a.count);
    // Assign rank
    members.forEach((m, i) => m.rank = i + 1);

    const command = args[0]?.toLowerCase();

    // ── .count all  or  .count top [N] ───────────────────────────────────────
    if (command === 'all' || command === 'top') {
      const limit = command === 'top' ? Math.min(parseInt(args[1]) || 10, 50) : members.length;
      const list = members.slice(0, limit).filter(m => m.count > 0);

      if (list.length === 0) {
        return message.reply("📊 No messages recorded in this group yet.");
      }

      let text = `📊 *Message Count — ${thread.name || "This Group"}*\n`;
      text += `${command === 'top' ? `Top ${limit}` : 'All members'} ranked by messages:\n\n`;

      for (const m of list) {
        const name = await getDisplayName(m.uid);
        const medal = m.rank === 1 ? "🥇" : m.rank === 2 ? "🥈" : m.rank === 3 ? "🥉" : `${m.rank}.`;
        text += `${medal} ${name}: *${m.count.toLocaleString()}* msg\n`;
      }

      text += `\n_Total active members: ${members.filter(m => m.count > 0).length}_`;
      return message.reply(text);
    }

    // ── .count @mention ───────────────────────────────────────────────────────
    if (event.mentions && Object.keys(event.mentions).length > 0) {
      const lines = [];
      for (const uid of Object.keys(event.mentions)) {
        const m = members.find(x => normUID(x.uid) === normUID(uid));
        const count = m ? m.count : (memberMsgCount[uid] || 0);
        const rank = m ? m.rank : "N/A";
        const name = event.mentions[uid] || await getDisplayName(uid);
        lines.push(`👤 *${name}*\n📩 *${count.toLocaleString()}* messages in this group\n🏅 Rank: *#${rank}/${members.filter(x => x.count > 0).length}*`);
      }
      return message.reply(lines.join("\n\n"));
    }

    // ── .count (self) ─────────────────────────────────────────────────────────
    const uid = event.senderID;
    const m = members.find(x => normUID(x.uid) === normUID(uid));
    const count = m ? m.count : (memberMsgCount[uid] || 0);
    const rank = m ? m.rank : "N/A";
    const total = members.filter(x => x.count > 0).length;
    const name = event.senderName || event.pushName || await getDisplayName(uid);

    return message.reply(
      `📊 *${name}*\n` +
      `📩 *${count.toLocaleString()}* messages in *${thread.name || "this group"}*\n` +
      `🏅 Rank: *#${rank}/${total}*`
    );
  }
};
