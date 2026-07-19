const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  // Define the slash command's name and description
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Replies with Pong! and shows the bot latency.'),

  async execute(interaction) {
    // Send an initial reply, then edit it with the round-trip latency
    const sent = await interaction.reply({ content: '🏓 Pinging...', fetchReply: true });

    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    const apiLatency = Math.round(interaction.client.ws.ping);

    await interaction.editReply(
      `🏓 Pong!\n> Round-trip: **${latency}ms** | API: **${apiLatency}ms**`
    );
  },
};
