import { Events, MessageFlags } from 'discord.js';

export default {
  name: Events.InteractionCreate,

  async execute(interaction) {
    // Suggestions while someone types an option (/reminders cancel offers their own).
    if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);
      try {
        await command?.autocomplete?.(interaction);
      } catch (error) {
        console.error(`❌ Autocomplete failed for /${interaction.commandName}:`, error);
      }
      return;
    }

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
      const errorMessage = {
        content: `❌ Tch, something went wrong running /${interaction.commandName}. Don't look at me, it's probably Captain's faulty code.`,
        flags: MessageFlags.Ephemeral,
      };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    }
  },
};
