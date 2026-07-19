const { Events } = require('discord.js');

module.exports = {
  name: Events.InteractionCreate,

  async execute(interaction) {
    // Only handle slash commands here
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
      console.error(`❌ No command found for: /${interaction.commandName}`);
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`❌ Error executing /${interaction.commandName}:`, error);

      const errorMessage = { content: '❌ Something went wrong running that command.', ephemeral: true };

      // Reply or follow up depending on whether we've already replied
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    }
  },
};
