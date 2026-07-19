const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hello')
    .setDescription('Greets a user.')
    // Options let users pass arguments to your command
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The user to greet (defaults to you)')
        .setRequired(false)
    ),

  async execute(interaction) {
    // Get the optional user argument, falling back to the command author
    const target = interaction.options.getUser('user') ?? interaction.user;

    const isSelf = target.id === interaction.user.id;
    const greeting = isSelf
      ? `👋 Hey there, ${target}!`
      : `👋 ${interaction.user} says hello to ${target}!`;

    await interaction.reply(greeting);
  },
};
