"use strict";

module.exports = {
  config: {
    name: "balance",
    aliases: ["bal"],
    version: "1.0.0",
    author: "Rômeo",
    countDown: 5,
    role: 0,
    shortDescription: "Check your or another user's balance",
    longDescription: "Shows money and ranking data. You can also transfer money to other users.",
    category: "economy",
    guide: { en: "{pn} [@mention | reply] | {pn} pay [@mention | reply] <amount>" }
  },

  onStart: async ({ api, event, args, message }) => {
    if (!global.GoatBot.DB) return message.reply("❌ Database not initialized.");

    // ── PAY COMMAND ──────────────────────────────────────────────────────────
    if (args[0] && args[0].toLowerCase() === "pay") {
      const targetUID = getTargetUser(event, args.slice(1));
      if (!targetUID || targetUID === event.senderID) {
        return message.reply("❌ Please tag or reply to someone else to send funds.");
      }

      const amountStr = args.find(a => !isNaN(a) && a > 0);
      const amount = parseInt(amountStr);
      if (!amount || amount <= 0) return message.reply("❌ Invalid amount.");

      const currency = "money";

      const senderData = await global.GoatBot.DB.userData(event.senderID);
      const receiverData = await global.GoatBot.DB.userData(targetUID);

      if ((senderData[currency] || 0) < amount) {
        return message.reply(`❌ You don't have enough ${currency}! (Your balance: ${senderData[currency] || 0})`);
      }

      await global.GoatBot.DB.users.set(event.senderID, { [currency]: (senderData[currency] || 0) - amount });
      await global.GoatBot.DB.users.set(targetUID, { [currency]: (receiverData[currency] || 0) + amount });

      return message.reply(`✅ Successfully transferred ${amount} ${currency.toUpperCase()}!`);
    }

    // ── CHECK BALANCE ────────────────────────────────────────────────────────
    const targetUID = getTargetUser(event, args);
    const phone = jidToPhone(targetUID);
    const isSelf = targetUID === event.senderID;

    const user = await global.GoatBot.DB.userData(targetUID);
    const name = user.name && user.name !== "Unknown" ? user.name : phone;

    return message.reply(
      `💰 *${isSelf ? "Your" : name + "'s"} Balance*\n\n` +
      `💵 Money: ${user.money || 0}`
    );
  }
};

