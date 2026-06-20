"use strict";

module.exports = {
  config: {
    name: "hiddentag",
    aliases: ["htag", "taghidden"],
    version: "1.0.0",
    author: "Rômeo",
    role: 1, // Usually restricted to admin/bot owner
    shortDescription: "Tag all members invisibly",
    longDescription: "Sends a message that notifies every member of the group without cluttering the message with @mentions.",
    category: "group",
    guide: { en: "{pn} [text]" }
  },

  onStart: async ({ api, event, args, message, threadsData }) => {
    try {
      if (!event.isGroup) {
        return message.reply("❌ This command can only be used in groups.");
      }

      const text = args.join(" ");
      if (!text) {
        return message.reply("❌ Please provide the message you want to send.");
      }


      // Fetch group data to get all member JIDs
      const thread = await threadsData(event.threadID);
      if (!thread || !thread.allMembers) {
        return message.reply("❌ Could not load group member data.");
      }

      // Filter to only include members currently in the group
      const activeMembers = thread.allMembers.filter(m => m.inGroup !== false);
      const jidArray = activeMembers.map(m => m.uid);

      // Send the text but attach all JIDs to the mentions array
      await api.sendMessage(
        {
          body: text,
          mentions: jidArray
        },
        event.threadID
      );


    } catch (err) {
      return message.reply("❌ Error sending hidden tag: " + err.message);
    }
  }
};
