"use strict";

module.exports = {
  config: {
    name: 'count',
    aliases: ['msgcount', 'messagecount'],
    version: "1.0.0",
    author: 'Rômeo',
    role: 0,
    shortDescription: 'Show message count',
    longDescription: 'Show message count for yourself or all group members',
    category: 'utility',
    guide: { en: '{pn} [all]' }
  },

  onStart: async ({ api, event, args, userData, threadsData, message }) => {
    if (!event.isGroup) {
      return message.reply("❌ This command can only be used in groups.");
    }

    const command = args[0]?.toLowerCase();

    if (command === 'all') {
      const thread = await threadsData(event.threadID);
      const participants = thread.allMembers || [];

      const activeParticipants = participants.filter(p => p.inGroup !== false);
      const membersWithCounts = [];

      for (const p of activeParticipants) {
        const u = await userData(p.uid);
        const count = u ? (u.msgCount || u.exp || 0) : 0;
        if (count > 0) {
          membersWithCounts.push({ uid: p.uid, count });
        }
      }

      membersWithCounts.sort((a, b) => b.count - a.count);

      let text = `📊 *Message Counts*\n\n`;
      const mentions = [];

      for (const member of membersWithCounts) {
        const number = member.uid.split('@')[0].split(':')[0];
        text += `@${number}: ${member.count} message${member.count === 1 ? '' : 's'}\n`;
        mentions.push(member.uid);
      }

      if (mentions.length === 0) text += "No messages recorded yet.";

      return api.sendMessage({ body: text, mentions }, event.threadID);
    } else {
      const u = await userData(event.senderID);
      const count = u ? (u.msgCount || u.exp || 0) : 0;
      return message.reply(`You have sent ${count} message${count === 1 ? '' : 's'} in total.`);
    }
  }
};
