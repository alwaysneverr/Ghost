import { 
  SlashCommandBuilder, 
  InteractionContextType, 
  ApplicationIntegrationType,
  EmbedBuilder,
} from 'discord.js';
 
// Add, remove, or edit your quotes here
const quotes = [
  { text: "Hey, quit gettin' all excited. God, I swear..."},
  { text: "Don't try to act all cool, Captain. You've barely ever been in a fight before."},
  { text: "Quit tryin' to boss me around, ya annoyin' twit. YOU follow ME."},
  { text: "Ora ora! Make way! Make way!"},
  { text: "You sure can badmouth someone when they're technically right in front of ya, y'know."},
  { text: "Yes, Your Highness. I'll show my best acting chops."},
];
 
export default {
  data: new SlashCommandBuilder()
    .setName('quote')
    .setDescription('Sends a random Lena quote.')
    .setContexts([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ])
    .setIntegrationTypes([
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    ]),
 
   async execute(interaction) {
    await interaction.deferReply();
 
    const { text, author } = quotes[Math.floor(Math.random() * quotes.length)];
 
    await interaction.editReply(`"${text}"`);
  },
};